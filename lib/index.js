import z from '@deepseek-ai/schemastery'
import { buildSystemPrompt, frameUserPrompt, cleanResult, estimateMaxTokens } from './prompt.js'
import { resolveRoute } from './route.js'

/** 提示词润色插件 · 宿主半体：注册 /api 精确路由，调用模型，SSE 流式回传 */

export const name = 'prompt-polish'

// ⚠️ 没有 Config 时 apply 的第二参就是 {}，所有 config.xxx 全部 undefined（静默失效）
// ⚠️ 设置页只认 .volatile() 字段：一个都没有 → 插件从设置列表整体消失
//    写非 volatile 字段 → 硬抛 Config field "x" is not volatile（dsh-settings/src/index.ts:386-390）
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  fixedProvider: z.string().default('').volatile(),
  fixedModel: z.string().default('').volatile(),
  temperature: z.number().min(0).max(1).default(0.2).volatile(),
  timeoutSeconds: z.natural().min(10).max(300).default(60).volatile(),
  maxDraftChars: z.natural().min(500).max(20000).default(8000).volatile(),
  maxTokens: z.natural().min(0).max(32768).default(0).volatile(),
  lengthRatio: z.number().min(1).max(3).default(2).volatile(),
  allowPlaceholder: z.boolean().default(true).volatile(),
})

// 不声明硬依赖，改用 ctx.inject 惰性挂载。
// 理由（读源码得知）：dsh-app-boot 的 requiredStartupEntryIds 只有 10 个，其余插件缺依赖只是一条 warning。
// 用硬依赖的坏处是「服务晚到就静默不激活」，用户看到的是按钮凭空消失且没有提示。
export const inject = []

const ROUTE_PATH = '/api/prompt-polish/polish'
const MAX_CONCURRENT = 2          // 主机侧全进程共享，多标签页共用这 2 个配额
const PING_MS = 15000

/**
 * ⚠️ 配置读取契约：`.volatile()` 字段在运行时**不是裸值，而是只有 get() 的对象**。
 *
 * 出处（实测）：schemastery/src/index.ts:521-527 返回 createVolatile(value)；
 *              cosmokit/src/volatile.ts:9-12 定义 Volatile<T> = { get(): T }；
 *              官方唯一写法 dsh-agent-default-model/src/index.ts:68-70 `this.config.provider.get()`。
 *
 * 裸读的后果全是静默失效、日志里毫无线索：
 *   config.enabled === false 恒假 → 总开关关不掉；typeof config.fixedProvider === 'string' 恒假 → 固定模型永不生效；
 *   Number.isFinite(config.maxTokens) 恒假 → NaN；`1~${config.lengthRatio}` 拼出 [object Object]。
 *
 * ⚠️ 必须**每个请求解包一次**，不能在 apply 里解一次就存起来：volatile 的意义就是热生效，
 *    存成快照后改设置要重启才生效，与「applies: live」矛盾（设计文档 5.12.5）。
 */
function readConfig(config) {
  const pick = (field, fallback) => {
    const raw = config?.[field]
    if (raw === undefined || raw === null) return fallback
    if (typeof raw.get === 'function') {
      const value = raw.get()
      return value === undefined ? fallback : value
    }
    return raw
  }
  return {
    enabled: pick('enabled', true),
    fixedProvider: pick('fixedProvider', ''),
    fixedModel: pick('fixedModel', ''),
    temperature: pick('temperature', 0.2),
    timeoutSeconds: pick('timeoutSeconds', 60),
    maxDraftChars: pick('maxDraftChars', 8000),
    maxTokens: pick('maxTokens', 0),
    lengthRatio: pick('lengthRatio', 2),
    allowPlaceholder: pick('allowPlaceholder', true),
  }
}

export function apply(ctx, config) {
  // 并发闸门必须是 apply 闭包内的变量（v1.0 漏声明，ESM 严格模式下直接 ReferenceError）
  let inflight = 0

  // ⚠️ 卸载信号必须是**插件级**、只注册一次。
  //    写成「每个请求里 scope.effect(...)」会随请求数无限累积（effect 只在插件 dispose 时清），
  //    既是内存泄漏，也会让第 N 次请求挂上 N 个 abort 回调。
  const unload = new AbortController()
  ctx.effect(() => () => {
    unload.abort()
    inflight = 0   // 卸载后计数归零，否则热重载回来全是 429
  }, 'prompt-polish: unload signal')

  // 按 sessionId 去重：同一会话重复点击（或两个标签页点同一会话）不该并行跑两次、双倍计费。
  // 光靠客户端 loading 挡不住——store 是每标签一份（模块级 Map），两个标签各自认为空闲。
  const active = new Set()
  const gate = {
    getInflight: () => inflight,
    hasSession: (sid) => sid !== '' && active.has(sid),
    enter: (sid) => { inflight += 1; if (sid !== '') active.add(sid) },
    leave: (sid) => { inflight = Math.max(0, inflight - 1); if (sid !== '') active.delete(sid) },
    unload: unload.signal,
  }

  // 惰性挂载：connection 与 llm 都在时才注册路由；缺任何一个都只是不挂，不影响宿主启动
  ctx.inject(['connection', 'llm'], (scope) => {
    // ⚠️ 这里**不要再包一层 scope.effect**：register 内部已经 owner.effect 了
    //    （rpc-host.ts:244-250 `return owner.effect(() => { ... })`），返回值本身就是 disposer。
    scope.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handle(scope, request, config, gate),
    })
  })
}

/** 统一的错误响应（v1.0 全文调了 6 次 bad() 却从未定义） */
function bad(status, message) {
  return new Response(JSON.stringify({ error: { code: `http-${status}`, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 把上游异常归类成客户端能识别的错误码 */
function classify(err) {
  const code = err?.code ?? err?.cause?.code
  if (code === 'ABORTED' || err?.name === 'AbortError') return 'aborted'
  if (code === 'NO_ADAPTER') return 'no-adapter'
  if (code === 'INVALID_PREPARED_CALL') return 'invalid-call'
  return 'upstream'
}

const ERROR_TEXT = {
  'aborted': '已取消',
  'no-adapter': '这个模型没有可用的适配器，请换一个模型或在设置里固定模型',
  'invalid-call': '内部调用状态异常，请重试',
  'timeout': '超时了，请缩短草稿或调大超时时间',
  'empty': '模型没有返回内容，请重试',
  'truncated': '改写被模型的输出上限截断，结果不完整。请把「长度倍数」调小，或在设置里把「输出 token 上限」调到模型允许的最大值',
  'upstream': '模型调用失败，请重试',
}

async function handle(scope, request, config, gate) {
  // 每次请求现读配置：volatile 字段改了就立刻生效，不需要重启（见 readConfig 注释）
  const c = readConfig(config)

  // 1) 只接受 JSON
  const type = request.headers.get('content-type') || ''
  if (!type.includes('application/json')) return bad(415, 'content-type must be application/json')

  // 2) 解析与校验
  //    ⚠️ JSON 合法值 null / 数字 / 数组都能解析成功，直接读 body.draft 会在 try 外抛 TypeError
  let body
  try { body = await request.json() } catch { return bad(400, 'invalid json') }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'body must be a JSON object')
  const draft = typeof body.draft === 'string' ? body.draft : ''
  if (draft.trim() === '') return bad(400, 'draft is empty')
  if (draft.length > c.maxDraftChars) return bad(413, `draft is longer than ${c.maxDraftChars} characters`)
  const sid = typeof body.sessionId === 'string' ? body.sessionId : ''

  // 3) 总开关。放在解析之后：关掉时返回 403 比「按钮消失」更容易排查
  if (c.enabled === false) return bad(403, 'prompt polish is disabled in settings')

  // 4) 并发闸门：先按会话去重（409），再按全进程并发（429）
  if (gate.hasSession(sid)) return bad(409, 'this session is already polishing')
  if (gate.getInflight() >= MAX_CONCURRENT) return bad(429, 'too many concurrent polish requests')

  // 5) 路由解析：四级都拿不到就 503
  const route = resolveRoute(scope, sid, c, body.modelSelection)
  if (route === null) return bad(503, 'no model available for polishing')

  // 6) 取消信号四路合并：客户端断开 / 插件卸载 / 流被 cancel / 超时
  //    request.signal 由 http-bridge.ts:44-56 在 res close 时 abort（断流即停上游、停止计费）
  const cancelCtl = new AbortController()
  const timeoutMs = Math.max(10, Number(c.timeoutSeconds) || 60) * 1000
  // ⚠️ 超时信号必须单独留一个引用：合并之后 AbortSignal.any 只告诉你「被中止了」，
  //    分不清是客户端断开、插件卸载，还是服务端自己超时。分不清的后果是
  //    超时被当成「用户主动取消」静默 return —— 用户只看到转圈然后什么都没发生
  //    （Mac 侧实测：上游首帧 6~16 秒，20 秒阈值下大量请求正好撞线，日志记 499）。
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  let timedOut = false
  timeoutSignal.addEventListener('abort', () => { timedOut = true }, { once: true })
  const signal = AbortSignal.any([
    request.signal,
    gate.unload,
    cancelCtl.signal,
    timeoutSignal,
  ])

  gate.enter(sid)
  let released = false
  const release = () => { if (!released) { released = true; gate.leave(sid) } }

  let stream;
  try {
    stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder()
        let closed = false
        // 连接是否已经没了：只有这三种情况不该再写。超时不在其中——
        // 超时恰恰要写一条 error 告诉用户，否则界面上就是转圈到停、毫无说明。
        const dead = () => request.signal.aborted || gate.unload.aborted || cancelCtl.signal.aborted
        const send = (event) => {
          if (closed || dead()) return
          // desiredSize === null 表示流已被取消/关闭，再 enqueue 会抛
          if (controller.desiredSize === null) { closed = true; return }
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)) }
          catch { closed = true }
        };
        // 立刻发一帧：全程零字节会被浏览器或中间代理当成死连接掐掉，
        // 而那时 request.signal 不会 abort，上游还在计费（复核 Codex 第 9 条）
        send({ type: 'start', provider: route.provider, model: route.model, source: route.source })
        const ping = setInterval(() => send({ type: 'ping' }), PING_MS)
        let text = ''
        let usage;
        let finish;
        try {
          let modelInfo;
          try { modelInfo = await scope.llm.resolveModelInfo(route.provider, route.model, signal) }
          catch { modelInfo = undefined }
          // ⚠️ 估算结果必须同时拿到 capped：被模型上限压住时，模型一定会在句子中间断掉，
          //    这时不能只报「截断失败」，要让用户知道是自己把长度倍数调太大了（问题 4 的根因）
          const budget = estimateMaxTokens(draft, c, modelInfo);
          const call = scope.llm.stream({
            provider: route.provider,
            model: route.model,
            system: buildSystemPrompt(c),
            // ⚠️ 一次性请求的消息既不带 id 也不带 source：
            //    RequestUserInput（dsh-llm/src/message.ts:530-539）把两者都声明成 `?: never`
            messages: [{
              role: 'user',
              content: [{ type: 'text', text: frameUserPrompt(draft, body.context) }],
            }],
            maxTokens: budget.maxTokens,
            temperature: Number.isFinite(c.temperature) ? c.temperature : 0.2,
            ...(sid === '' ? {} : { sessionId: sid }),
            purpose: 'prompt-polish',
            signal,
          })
          for await (const chunk of call) {
            // 超时/取消后立刻停：继续读只会把上游剩下的 token 也计费进来
            if (signal.aborted) break
            if (chunk.type === 'text-delta' && chunk.text) {
              text += chunk.text
              send({ type: 'delta', text: chunk.text })
            } else if (chunk.type === 'usage') {
              usage = chunk.usage
            } else if (chunk.type === 'finish') {
              finish = chunk.reason
            }
          }

          // ⚠️ 超时优先判定：signal.aborted 会让循环提前 break，此时 text 是半截稿、
          //    finish 通常为 undefined。不先拦这一刀，半句稿会被当成完整结果写进输入框。
          if (timedOut) {
            send({ type: 'error', code: 'timeout', message: ERROR_TEXT.timeout })
            return
          }
          if (signal.aborted && finish === undefined) {
            // 客户端断开或插件卸载：连接那头已经没了，不必再写，也不能报成成功
            return
          }

          // 截断判定：FinishReason 是对象，判别字段是 kind，最大长度值是 max-tokens
          //（dsh-llm/src/types.ts:163-172）。写成 === 'length' 永远判不到，半句稿会被当完整结果
          if (finish?.kind === 'max-tokens') {
            send({ type: 'error', code: 'truncated', message: ERROR_TEXT.truncated })
            return
          }
          if (finish?.kind === 'error') {
            send({ type: 'error', code: 'upstream', message: finish.failure?.message ?? ERROR_TEXT.upstream })
            return
          }
          if (finish?.kind === 'aborted') {
            // 三种中止要分开报：超时（能救，让用户调大阈值）、客户端断开（不必写）、
            // 其它服务端中止（告诉用户被取消了）
            if (timedOut) send({ type: 'error', code: 'timeout', message: ERROR_TEXT.timeout })
            else if (!signal.aborted) send({ type: 'error', code: 'aborted', message: ERROR_TEXT.aborted })
            return
          }
          const cleaned = cleanResult(text)
          if (cleaned === '') {
            send({ type: 'error', code: 'empty', message: ERROR_TEXT.empty })
            return
          }
          send({ type: 'done', text: cleaned, usage: usage ?? null, capped: budget.capped, maxTokens: budget.maxTokens })
        } catch (err) {
          const code = classify(err)
          // 超时不是「用户取消」，必须报出来，否则界面上就是转圈到停、没有任何说明
          if (timedOut) {
            send({ type: 'error', code: 'timeout', message: ERROR_TEXT.timeout })
            return
          }
          // 客户端主动取消属于正常路径，不当作错误弹给用户
          if (code === 'aborted' && signal.aborted) return
          send({ type: 'error', code, message: ERROR_TEXT[code] ?? ERROR_TEXT.upstream })
        } finally {
          clearInterval(ping)
          release()
          closed = true
          try { controller.close() } catch { /* 已关闭 */ }
        }
      },
      // 客户端断开或 reader.cancel() 时触发：立刻中止上游，停止计费
      cancel() {
        cancelCtl.abort()
        release()
      },
    })
  } catch (err) {
    release()
    throw err
  }

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}

// 仅供 tools/selfcheck.cjs 直接断言（宿主加载时这些导出无害，不会被当成插件 API）
export { readConfig, handle, bad, classify, ROUTE_PATH, MAX_CONCURRENT }
