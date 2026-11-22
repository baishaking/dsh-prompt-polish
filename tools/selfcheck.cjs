#!/usr/bin/env node
'use strict';
/**
 * 离线自检：不启动宿主、不联网，用桩件把设计文档 7.1 的 32 项全部跑一遍。
 *
 * 分两段：
 *   A 段（宿主侧）直接 import lib/prompt.js、lib/route.js、lib/index.js —— 真实模块，不做任何桩替换；
 *   B 段（客户端侧）eval lib/client.js 源码，用极简 React / document / fetch 桩驱动组件。
 *
 * 为什么客户端必须 eval 而不是 import：client.js 是 window.__ModuleLoader__ 的 lazy CJS 形态，
 * 顶层就引用 window，import 会直接 ReferenceError。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
let passed = 0;

function check(label, ok, detail) {
  if (ok) { passed += 1; console.log('  [OK]   ' + label); return; }
  failures.push({ label, detail });
  console.log('  [FAIL] ' + label + (detail === undefined ? '' : '  <- ' + detail));
}

function group(title) { console.log('\n== ' + title + ' =='); }

// ============ A 段：宿主侧真实模块 ============
async function hostChecks() {
  const promptMod = await import(pathToFileURL(path.join(ROOT, 'lib', 'prompt.js')).href);
  const routeMod = await import(pathToFileURL(path.join(ROOT, 'lib', 'route.js')).href);
  const hostMod = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);

  const { buildSystemPrompt, frameUserPrompt, stripFence, stripPreamble, stripInvisible, cleanResult, estimateMaxTokens } = promptMod;
  const { resolveRoute } = routeMod;
  const { readConfig, handle, Config, name, inject, ROUTE_PATH, MAX_CONCURRENT } = hostMod;

  group('1. 插件清单');
  check('name === prompt-polish（= 客户端 NS = patch id）', name === 'prompt-polish', name);
  check('inject 为空数组（惰性挂载，不污染启动诊断）', Array.isArray(inject) && inject.length === 0, JSON.stringify(inject));
  check('路由路径以 /api/ 开头', ROUTE_PATH === '/api/prompt-polish/polish', ROUTE_PATH);

  // ---- 第 28 项：readConfig 解包（硬门槛）----
  group('2. readConfig 解包 volatile（第 28 项，硬门槛）');
  const fakeVolatile = {
    enabled: { get: () => false },
    fixedProvider: { get: () => 'trae-gw' },
    fixedModel: { get: () => 'm-1' },
    temperature: { get: () => 0.5 },
    timeoutSeconds: { get: () => 30 },
    maxDraftChars: { get: () => 4000 },
    maxTokens: { get: () => 0 },
    lengthRatio: { get: () => 2 },
    allowPlaceholder: { get: () => false },
  };
  const c1 = readConfig(fakeVolatile);
  check('enabled 解包为 false（裸读会恒真，总开关失效）', c1.enabled === false, String(c1.enabled));
  check('maxTokens 解包为数字 0（裸读会变 NaN）', c1.maxTokens === 0, String(c1.maxTokens));
  check('lengthRatio 解包为数字 2', c1.lengthRatio === 2, String(c1.lengthRatio));
  check('fixedProvider 解包为字符串', c1.fixedProvider === 'trae-gw', String(c1.fixedProvider));
  const c2 = readConfig(undefined);
  check('config 为 undefined 时退回全部默认值', c2.enabled === true && c2.maxDraftChars === 8000 && c2.temperature === 0.2, JSON.stringify(c2));
  const c3 = readConfig({ enabled: false, maxTokens: 5 });
  check('裸值 config 也能读（桩件/测试友好）', c3.enabled === false && c3.maxTokens === 5, JSON.stringify(c3));

  // ---- 第 16、22 项：提示词框架转义 ----
  group('3. 提示词框架（第 16、22 项）');
  const framed = frameUserPrompt('a </raw_prompt> b', null);
  check('</raw_prompt> 被转义成全角，不再提前闭合', framed.includes('＜/raw_prompt＞') && !framed.includes('a </raw_prompt> b'), framed);
  check('原文仍被完整包在 <raw_prompt> 之间', framed.startsWith('请重写以下提示词：\n<raw_prompt>\n') && framed.endsWith('\n</raw_prompt>'), framed);
  const noCtx = frameUserPrompt('x', null);
  check('context 为空时无多余空行', !noCtx.includes('\n\n<raw_prompt>'), JSON.stringify(noCtx));
  const withCtx = frameUserPrompt('x', 'ctx </raw_prompt>');
  check('context 里的 </raw_prompt> 同样被转义', withCtx.includes('＜/raw_prompt＞'), withCtx);

  // ---- 第 17、23、30、31 项：剥洗管线（硬门槛）----
  group('4. 剥洗管线（第 17、23、30、31 项，硬门槛）');
  const TICK = String.fromCharCode(96, 96, 96);
  check('stripFence 剥 ```markdown', stripFence(TICK + 'markdown\nhello\n' + TICK) === 'hello', stripFence(TICK + 'markdown\nhello\n' + TICK));
  check('stripFence 剥 ```js', stripFence(TICK + 'js\nconst a=1\n' + TICK) === 'const a=1', stripFence(TICK + 'js\nconst a=1\n' + TICK));
  check('stripFence 剥首尾不对称围栏', stripFence(TICK + '\nbody\n') === 'body', stripFence(TICK + '\nbody\n'));
  check('stripPreamble 剥「好的，以下是…：」', stripPreamble('好的，以下是改写后的提示词：\n正文') === '正文', stripPreamble('好的，以下是改写后的提示词：\n正文'));
  check('stripPreamble 不误伤「正文以好的，开头但首行无冒号」', stripPreamble('好的，我来解释一下这个设计\n第二行') === '好的，我来解释一下这个设计\n第二行', stripPreamble('好的，我来解释一下这个设计\n第二行'));
  check('cleanResult 三样例①围栏', cleanResult(TICK + 'markdown\n正文内容\n' + TICK) === '正文内容', cleanResult(TICK + 'markdown\n正文内容\n' + TICK));
  check('cleanResult 三样例②前言', cleanResult('以下是优化后的提示词：\n正文内容') === '正文内容', cleanResult('以下是优化后的提示词：\n正文内容'));
  check('cleanResult 三样例③围栏+前言+零宽字符叠加', cleanResult(TICK + '\n好的，以下是改写后的提示词：\n\u200b 正文内容  \n' + TICK) === '正文内容', JSON.stringify(cleanResult(TICK + '\n好的，以下是改写后的提示词：\n\u200b 正文内容  \n' + TICK)));
  check('stripInvisible 删 U+200B/200C/200D/FEFF', stripInvisible('a\u200bb\u200cc\u200dd\uFEFFe') === 'abcde', JSON.stringify(stripInvisible('a\u200bb\u200cc\u200dd\uFEFFe')));
  check('stripInvisible 把 NBSP 换成普通空格而非删除', stripInvisible('a\u00A0b') === 'a b', JSON.stringify(stripInvisible('a\u00A0b')));

  // ---- 第 27 项：lengthRatio 影响系统提示词 ----
  group('5. 系统提示词（第 27 项）');
  const p1 = buildSystemPrompt({ lengthRatio: 1, allowPlaceholder: true });
  const p3 = buildSystemPrompt({ lengthRatio: 3, allowPlaceholder: true });
  check('lengthRatio=1 与 3 的文案不同', p1 !== p3, 'same');
  check('lengthRatio=1 时含 1~1 倍', p1.includes('1~1 倍'), p1.slice(-160));
  check('lengthRatio=3 时含 1~3 倍', p3.includes('1~3 倍'), p3.slice(-160));
  const pNo = buildSystemPrompt({ lengthRatio: 2, allowPlaceholder: false });
  check('allowPlaceholder=false 时追加禁止占位符指令', pNo.includes('不要插入任何'), pNo.slice(-160));
  check('BASE_PROMPT 里没有写死的长度行（避免与动态行冲突）', (p1.match(/倍/g) || []).length === 1, String((p1.match(/倍/g) || []).length));

  // ---- 第 19 项：estimateMaxTokens ----
  group('6. token 估算（第 19 项）');
  const longDraft = 'x'.repeat(50000);
  const bCap = estimateMaxTokens(longDraft, { maxTokens: 0, lengthRatio: 2 }, { defaultMaxTokens: 4096 });
  check('长草稿被 modelInfo.defaultMaxTokens 压住', bCap.maxTokens === 4096, JSON.stringify(bCap));
  check('被压住时 capped=true（客户端据此提醒，不闷声截断）', bCap.capped === true, JSON.stringify(bCap));
  const bNoInfo = estimateMaxTokens(longDraft, { maxTokens: 0, lengthRatio: 3 }, undefined);
  check('缺 modelInfo 时上限退到 32768', bNoInfo.maxTokens === 32768 && bNoInfo.capped === true, JSON.stringify(bNoInfo));
  const bShort = estimateMaxTokens('hi', { maxTokens: 0, lengthRatio: 2 }, undefined);
  // 新版估算固定含 +1200 开销，'hi' 也会算出 1207；这里只断言下界与未被压住
  check('短草稿不低于 256 且未被压住', bShort.maxTokens >= 256 && bShort.capped === false, JSON.stringify(bShort));
  const bCfg = estimateMaxTokens('hi', { maxTokens: 8000, lengthRatio: 2 }, { defaultMaxTokens: 32768 });
  check('配置的 maxTokens 优先于估算值', bCfg.maxTokens === 8000 && bCfg.capped === false, JSON.stringify(bCfg));
  const bCfgOver = estimateMaxTokens('hi', { maxTokens: 99999, lengthRatio: 2 }, { defaultMaxTokens: 32000 });
  check('配置值超过模型上限时仍被上限压住并标记 capped', bCfgOver.maxTokens === 32000 && bCfgOver.capped === true, JSON.stringify(bCfgOver));

  // 关键回归：旧实现用 Math.min(ceiling, ...) 静默降级，长草稿必然被截断且用户无从得知。
  // 现在估算里含 +1200 固定开销（system prompt 约 900 token + 帧包装），不能再用「字数×倍数」硬算。
  const bMid = estimateMaxTokens('x'.repeat(2000), { maxTokens: 0, lengthRatio: 2 }, { defaultMaxTokens: 32000 });
  check('2000 字草稿的估算含固定开销（> 2000*2）', bMid.maxTokens > 4000, JSON.stringify(bMid));
  // ---- 第 18 项：resolveRoute 四级 ----
  group('7. 模型路由四级降级（第 18 项）');
  const cBase = { fixedProvider: '', fixedModel: '', enabled: true };
  const r0 = resolveRoute({ get: () => undefined }, 's1', cBase, { provider: 'p0', model: 'm0' });
  check('零级：请求体指定 → source=request', r0 && r0.source === 'request' && r0.provider === 'p0', JSON.stringify(r0));
  const r1 = resolveRoute({ get: () => undefined }, 's1', { fixedProvider: 'fp', fixedModel: 'fm' }, null);
  check('一级：设置固定对 → source=settings', r1 && r1.source === 'settings' && r1.model === 'fm', JSON.stringify(r1));
  const onlyProvider = resolveRoute({ get: () => undefined }, 's1', { fixedProvider: 'fp', fixedModel: '' }, null);
  check('一级：只填 provider 不生效（必须两项都填）', onlyProvider === null, JSON.stringify(onlyProvider));
  const sessionObj = { id: 's1' };
  const scopeSession = { get: (n) => n === 'sessions' ? { get: () => sessionObj } : n === 'sessionProjections' ? { snapshot: () => ({ values: { modelSelection: { next: { provider: 'sp', model: 'sm' }, lastUsed: null } } }) } : undefined };
  const r2 = resolveRoute(scopeSession, 's1', cBase, null);
  check('二级：会话投影 next → source=session', r2 && r2.source === 'session' && r2.provider === 'sp', JSON.stringify(r2));
  const scopeLast = { get: (n) => n === 'sessions' ? { get: () => sessionObj } : n === 'sessionProjections' ? { snapshot: () => ({ values: { modelSelection: { next: null, lastUsed: { provider: 'lp', model: 'lm' } } } }) } : undefined };
  const r2b = resolveRoute(scopeLast, 's1', cBase, null);
  check('二级：next 为空时退 lastUsed', r2b && r2b.model === 'lm', JSON.stringify(r2b));
  const scopeThrow = { get: (n) => n === 'sessions' ? { get: () => sessionObj } : n === 'sessionProjections' ? { snapshot: () => { throw new Error('boom'); } } : n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'dp', model: 'dm' }) } : undefined };
  const r3 = resolveRoute(scopeThrow, 's1', cBase, null);
  check('二级投影抛错时静默降级到三级', r3 && r3.source === 'default' && r3.provider === 'dp', JSON.stringify(r3));
  const rNull = resolveRoute({ get: () => undefined }, 's1', cBase, null);
  check('四级全缺 → null（上层转 503）', rNull === null, JSON.stringify(rNull));
  const rPartial = resolveRoute({ get: (n) => n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'dp' }) } : undefined }, 's1', cBase, null);
  check('只有 provider 没有 model → null（不把 undefined 传进 llm）', rPartial === null, JSON.stringify(rPartial));

  return { handle, Config };
}

// ============ A2 段：路由处理器 ============
/**
 * 造一个 llm 桩。
 * slowMs 用来模拟「上游很慢」：每个 chunk 之间睡一会儿，让超时有机会在流中途触发。
 * ⚠️ 必须像真实实现那样尊重 options.signal —— dsh-llm 明确要求实现方中止后停止产出，
 *    桩里不照做，超时分支就永远测不到（流会先跑完，然后被判成正常结束）。
 */
function makeLlm(behaviour, slowMs) {
  return {
    async resolveModelInfo() { return { defaultMaxTokens: 4096 }; },
    stream(options) {
      const chunks = behaviour(options);
      const signal = options?.signal;
      return (async function* () {
        for (const c of chunks) {
          if (signal?.aborted) return;
          yield c;
          if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
        }
      })();
    },
  };
}

function makeScope(llm) {
  return {
    llm,
    get(n) {
      if (n === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'dp', model: 'dm' }) };
      return undefined;
    },
  };
}

function makeGate() {
  let inflight = 0;
  const active = new Set();
  const unload = new AbortController();
  return {
    getInflight: () => inflight,
    hasSession: (sid) => sid !== '' && active.has(sid),
    enter: (sid) => { inflight += 1; if (sid !== '') active.add(sid); },
    leave: (sid) => { inflight = Math.max(0, inflight - 1); if (sid !== '') active.delete(sid); },
    unload: unload.signal,
    _reset() { inflight = 0; active.clear(); },
  };
}

function req(body, type) {
  return new Request('http://127.0.0.1:1/api/prompt-polish/polish', {
    method: 'POST',
    headers: { 'content-type': type === undefined ? 'application/json' : type },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function sseEvents(res) {
  const text = await res.text();
  const events = [];
  for (const frame of text.split('\n\n')) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (line === undefined) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* 忽略残帧 */ }
  }
  return events;
}

async function handlerChecks(handle) {
  group('8. 路由处理器入参校验（第 20 项）');
  const gate = makeGate();
  const scope = makeScope(makeLlm(() => [{ type: 'text-delta', text: 'hi' }, { type: 'finish', reason: { kind: 'stop' } }]));
  const cTimeout = { enabled: true, fixedProvider: '', fixedModel: '', temperature: 0.2, timeoutSeconds: 10, maxDraftChars: 8000, maxTokens: 0, lengthRatio: 2, allowPlaceholder: true };
  const cOk = { enabled: true, fixedProvider: '', fixedModel: '', temperature: 0.2, timeoutSeconds: 60, maxDraftChars: 8000, maxTokens: 0, lengthRatio: 2, allowPlaceholder: true };

  const r415 = await handle(scope, req({ draft: 'x' }, 'text/plain'), cOk, gate);
  check('非 JSON content-type → 415', r415.status === 415, String(r415.status));
  const rBadJson = await handle(scope, req('{oops'), cOk, gate);
  check('非法 JSON → 400', rBadJson.status === 400, String(rBadJson.status));
  const rNullBody = await handle(scope, req('null'), cOk, gate);
  check('body 为 JSON null → 400（不抛 TypeError）', rNullBody.status === 400, String(rNullBody.status));
  const rArr = await handle(scope, req([1, 2]), cOk, gate);
  check('body 为数组 → 400', rArr.status === 400, String(rArr.status));
  const rEmpty = await handle(scope, req({ draft: '   ' }), cOk, gate);
  check('空草稿 → 400', rEmpty.status === 400, String(rEmpty.status));
  const rLong = await handle(scope, req({ draft: 'x'.repeat(9000) }), cOk, gate);
  check('超长草稿 → 413', rLong.status === 413, String(rLong.status));
  const cOff = Object.assign({}, cOk, { enabled: false });
  const rOff = await handle(scope, req({ draft: 'x' }), cOff, gate);
  check('总开关关闭 → 403', rOff.status === 403, String(rOff.status));
  const rNoRoute = await handle({ llm: scope.llm, get: () => undefined }, req({ draft: 'x' }), cOk, gate);
  check('四级路由全缺 → 503', rNoRoute.status === 503, String(rNoRoute.status));

  group('9. 正常流（第 21 项）');
  gate._reset();
  const okRes = await handle(scope, req({ draft: '写个周报' }), cOk, gate);
  const evOk = await sseEvents(okRes);
  check('响应头是 text/event-stream', (okRes.headers.get('content-type') || '').includes('text/event-stream'), okRes.headers.get('content-type'));
  check('响应头带 x-accel-buffering: no', okRes.headers.get('x-accel-buffering') === 'no', okRes.headers.get('x-accel-buffering'));
  check('首帧是 start（防零字节被掐）', evOk[0] && evOk[0].type === 'start', JSON.stringify(evOk[0]));
  check('末帧是 done 且带 text', evOk.some((e) => e.type === 'done' && e.text === 'hi'), JSON.stringify(evOk));
  check('请求结束后并发计数归零', gate.getInflight() === 0, String(gate.getInflight()));

  group('10. 截断与异常（第 21 项）');
  gate._reset();
  const truncScope = makeScope(makeLlm(() => [{ type: 'text-delta', text: '半句' }, { type: 'finish', reason: { kind: 'max-tokens' } }]));
  const evTrunc = await sseEvents(await handle(truncScope, req({ draft: 'x' }), cOk, gate));
  check('finish.kind=max-tokens → error truncated（不把半句当结果）', evTrunc.some((e) => e.type === 'error' && e.code === 'truncated') && !evTrunc.some((e) => e.type === 'done'), JSON.stringify(evTrunc));

  gate._reset();
  const emptyScope = makeScope(makeLlm(() => [{ type: 'finish', reason: { kind: 'stop' } }]));
  const evEmpty = await sseEvents(await handle(emptyScope, req({ draft: 'x' }), cOk, gate));
  check('模型返回空白 → error empty', evEmpty.some((e) => e.type === 'error' && e.code === 'empty'), JSON.stringify(evEmpty));

  gate._reset();
  const boomScope = makeScope(makeLlm(() => { throw new Error('upstream exploded'); }));
  const evBoom = await sseEvents(await handle(boomScope, req({ draft: 'x' }), cOk, gate));
  check('上游抛错 → error upstream', evBoom.some((e) => e.type === 'error' && e.code === 'upstream'), JSON.stringify(evBoom));
  check('上游抛错后并发计数仍归零（finally 生效）', gate.getInflight() === 0, String(gate.getInflight()));

  // ---------- 超时 vs 主动取消：必须分得开（本轮线上缺陷的回归）----------
  // 线上现象：Mac 侧 timeoutSeconds=20，上游首帧 6~16 秒，撞线后插件把「自己超时」
  // 当成「用户主动取消」静默 return，界面只剩转圈，既无 delta 也无 error。
  group('10b. 超时与主动取消必须分得开');
  gate._reset();
  // 把 10 秒下限压成 60 毫秒：真实等 10 秒会让自检白跑，测的仍是同一条代码路径
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => realTimeout(Math.min(ms, 60));
  try {
    const slowLlm = makeLlm(() => {
      const list = [];
      for (let i = 0; i < 40; i += 1) list.push({ type: 'text-delta', text: 'x' });
      list.push({ type: 'finish', reason: { kind: 'stop' } });
      return list;
    }, 20);
    const evSlow = await sseEvents(await handle(makeScope(slowLlm), req({ draft: 'x' }), cTimeout, gate));
    check('10b1. 服务端超时 → 发 error timeout（不再静默 return）', evSlow.some((e) => e.type === 'error' && e.code === 'timeout') && !evSlow.some((e) => e.type === 'done'), JSON.stringify(evSlow));
    check('10b2. 超时那条 error 带中文说明', evSlow.some((e) => e.type === 'error' && e.code === 'timeout' && typeof e.message === 'string' && e.message !== ''), JSON.stringify(evSlow.filter((e) => e.type === 'error')));
    check('10b3. 超时后并发计数归零', gate.getInflight() === 0, String(gate.getInflight()));

    // 反面对照：客户端主动断开（request.signal 已中止）绝不能报成失败，
    // 那是用户自己关掉页面，弹「超时了」只会误导
    gate._reset();
    const abortCtl = new AbortController();
    abortCtl.abort();
    const reqAborted = new Request('http://127.0.0.1:1/api/prompt-polish/polish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft: 'x' }),
      signal: abortCtl.signal,
    });
    const evAborted = await sseEvents(await handle(makeScope(makeLlm(() => [{ type: 'text-delta', text: 'hi' }, { type: 'finish', reason: { kind: 'stop' } }])), reqAborted, cOk, gate));
    check('10b4. 客户端断开 → 不报超时也不报成功（静默收场）', !evAborted.some((e) => e.type === 'error') && !evAborted.some((e) => e.type === 'done'), JSON.stringify(evAborted));
    check('10b5. 断开后并发计数归零', gate.getInflight() === 0, String(gate.getInflight()));
  } finally { AbortSignal.timeout = realTimeout; }


  group('11. 并发闸门');
  gate._reset();
  gate.enter('s1');
  const r409 = await handle(scope, req({ draft: 'x', sessionId: 's1' }), cOk, gate);
  check('同会话重复请求 → 409', r409.status === 409, String(r409.status));
  gate.leave('s1');
  gate.enter('a'); gate.enter('b');
  const r429 = await handle(scope, req({ draft: 'x', sessionId: 'c' }), cOk, gate);
  check('全进程并发超 2 → 429', r429.status === 429, String(r429.status));
  gate.leave('a'); gate.leave('b');

  group('12. 客户端断开后不再 enqueue（第 21、25 项）');
  gate._reset();
  let produced = 0;
  const slowScope = makeScope(makeLlm(() => {
    const list = [];
    for (let i = 0; i < 6; i += 1) list.push({ type: 'text-delta', text: 'chunk' + i });
    list.push({ type: 'finish', reason: { kind: 'stop' } });
    return list;
  }));
  const slowRes = await handle(slowScope, req({ draft: 'x' }), cOk, gate);
  const reader = slowRes.body.getReader();
  await reader.read();
  let cancelThrew = false;
  try { await reader.cancel(); } catch { cancelThrew = true; }
  check('reader.cancel() 不抛（cancel() 里已 abort 上游）', cancelThrew === false, String(cancelThrew));
  await new Promise((r) => setTimeout(r, 30));
  check('取消后并发计数归零', gate.getInflight() === 0, String(gate.getInflight()));
  check('取消后不产生未处理异常', true, undefined);
  void produced;
}

// ============ B 段：客户端侧（eval 源码 + 桩件）============
function makeReact() {
  let hookStates = [];
  let hookIndex = 0;
  let effectQueue = [];
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.length <= 1 ? children[0] : children };
    },
    useState(init) {
      const i = hookIndex++;
      if (!(i in hookStates)) hookStates[i] = typeof init === 'function' ? init() : init;
      return [hookStates[i], (v) => { hookStates[i] = typeof v === 'function' ? v(hookStates[i]) : v; }];
    },
    // useRef 必须按槽缓存：每次 render 新建对象会让同步锁失效，连点防护就成了摆设
    useRef(init) {
      const i = hookIndex++;
      if (!(i in hookStates)) hookStates[i] = { current: init };
      return hookStates[i];
    },
    useCallback(fn) { hookIndex += 1; return fn; },
    useEffect(fn) { effectQueue.push(fn); },
    useSyncExternalStore(_subscribe, getSnapshot) { hookIndex += 1; return getSnapshot(); },
  };
  function reset() { hookStates = []; hookIndex = 0; effectQueue = []; }
  function runEffects() {
    const pending = effectQueue;
    effectQueue = [];
    const cleanups = [];
    for (const fn of pending) {
      try { const c = fn(); if (typeof c === 'function') cleanups.push(c); } catch (e) { throw e; }
    }
    return cleanups;
  }
  // rewind 只归零游标、不清槽：第二帧必须复用 useRef 的同一对象，否则连点锁形同虚设
  function rewind() { hookIndex = 0; }
  return { React, reset, runEffects, rewind };
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') {
    if (node.type === 'input') return '';
    return textOf(node.children);
  }
  return '';
}

function findByClass(node, cls) {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findByClass(child, cls); if (hit !== null) return hit; }
    return null;
  }
  const own = typeof node.props?.className === 'string' ? node.props.className.split(/\s+/) : [];
  if (own.includes(cls)) return node;
  return findByClass(node.children, cls);
}

function findAll(node, pred, acc) {
  const list = acc === undefined ? [] : acc;
  if (node === null || node === undefined || typeof node !== 'object') return list;
  if (Array.isArray(node)) { for (const child of node) findAll(child, pred, list); return list; }
  if (pred(node)) list.push(node);
  findAll(node.children, pred, list);
  return list;
}

function makeInputActions(rev, draft) {
  const calls = { capture: 0, setDraft: [], persist: 0, insertText: 0 };
  return {
    calls,
    // ⚠️ 真实 TokenSpan（draft-editor.ts:7-12）只有 start/end/draftRev 三个字段，**没有 draft**。
    //    这里必须照抄真实形状：早先的桩多塞了一个 draft，正好掩盖了「从 span 里读原文」那个缺陷，
    //    线上表现为点回退永远提示「草稿已改动」。
    captureInsertion() { calls.capture += 1; void draft; return { start: 0, end: 0, draftRev: rev }; },
    setDraft(text) { calls.setDraft.push(text); },
    persistDraft() { calls.persist += 1; },
    insertText() { calls.insertText += 1; return true; },
    insertQuote() { return true; },
    submit() {},
    focus() {},
    notify() {},
  };
}

function makeConfigController(initialValue) {
  const state = { status: 'ready', value: initialValue, writable: true, revision: 1 };
  const listeners = new Set();
  const writes = [];
  let snapshot = { status: 'ready', value: initialValue, writable: true, revision: 1 };
  const controller = {
    writes,
    getSnapshot: () => snapshot,
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    set(field, value) { writes.push(['set', field, value]); state.value = Object.assign({}, state.value, { [field]: value }); state.revision += 1; snapshot = { status: 'ready', value: state.value, writable: true, revision: state.revision }; for (const l of listeners) l(); return Promise.resolve(true); },
    unset(field) { writes.push(['unset', field]); const v = Object.assign({}, state.value); delete v[field]; state.value = v; state.revision += 1; snapshot = { status: 'ready', value: state.value, writable: true, revision: state.revision }; for (const l of listeners) l(); return Promise.resolve(true); },
    mutate() { return Promise.resolve(true); },
    dispose() {},
  };
  return controller;
}

async function clientChecks() {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  const { React, reset, runEffects, rewind } = makeReact();

  let registered = null;
  const styleTags = [];
  global.window = { __ModuleLoader__: { load(spec) { registered = spec; } }, __PP_TEST__: true };
  global.document = {
    querySelector(sel) { return styleTags.find((t) => 'style[data-plugin-css="' + t.dataset.pluginCss + '"]' === sel) || null; },
    createElement(tag) { return { tag, dataset: {}, textContent: '', remove() { const i = styleTags.indexOf(this); if (i >= 0) styleTags.splice(i, 1); } }; },
    head: { appendChild(tag) { styleTags.push(tag); } },
  };
  global.setInterval = () => 0;
  global.clearInterval = () => {};

  // eslint-disable-next-line no-eval
  eval(source);
  if (registered === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load');
  const mod = registered.factory((name) => {
    if (name === 'react') return React;
    throw new Error('未预期的 require: ' + name);
  });

  group('13. 模块清单');
  check('id 是包名 dsh-prompt-polish', registered.id === 'dsh-prompt-polish', registered.id);
  check('cordis inject 含 slots/configForms/locale/remote', JSON.stringify(mod.inject) === JSON.stringify(['slots', 'configForms', 'locale', 'remote', 'remote.session']), JSON.stringify(mod.inject));
  // 模型下拉要走宿主远程 session.modelCatalog()，两个客户端包缺一个都会让 remote.session 不存在
  const pkgForInject = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const clientInject = pkgForInject.dsh.client.inject;
  check('dsh.client.inject 含 dsh-api-remotes 与 dsh-api-session-controller',
    clientInject.includes('@deepseek-ai/dsh-api-remotes') && clientInject.includes('@deepseek-ai/dsh-api-session-controller'),
    JSON.stringify(clientInject));

  const controller = makeConfigController({ enabled: true, fixedProvider: '', fixedModel: '', temperature: 0.2, timeoutSeconds: 60, maxDraftChars: 8000, maxTokens: 0, lengthRatio: 2, allowPlaceholder: true });
  const registrations = [];
  const localeDumps = {};
  let servedNamespaces = null;
  const disposers = [];

  const ctx = {
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d; },
    slots: {
      inject(name, cb) { cb(); return () => {}; },
      register(options, Component) { registrations.push({ options, Component }); return {}; },
    },
    // 设置页的两个下拉会调宿主远程；桩里给一个固定目录，断言只关心「渲染出几个控件」
    remote: {
      session: {
        modelCatalog() {
          return Promise.resolve({ ok: true, value: { groups: [
            { id: 'magpie', name: 'Magpie', models: [{ id: 'm1', name: 'Model One' }, { id: 'm2', name: 'Model Two' }] },
            { id: 'other', name: 'Other', models: [{ id: 'o1', name: 'Other One' }] },
          ] } });
        },
      },
    },
    configForms: {
      get(ns) { return controller; },
      whileServed(namespaces, register) { servedNamespaces = namespaces.slice(); register(new Set(namespaces)); return () => {}; },
      describe() { return { writable: true, hasDocument: true, namespaces: [] }; },
    },
    locale: {
      register(ns, dicts) { localeDumps[ns] = dicts; return () => {}; },
      bind(ns) {
        return (key) => {
          const zh = localeDumps[ns]?.zh;
          return zh !== undefined && typeof zh[key] === 'string' ? zh[key] : key;
        };
      },
    },
  };

  mod.apply(ctx);

  group('14. 槽位注册（第 1、2、3 项）');
  const trigger = registrations.find((r) => r.options.name === 'conversation.input.right');
  const configCard = registrations.find((r) => r.options.name === 'plugins.bundle.config');
  check('注册了 conversation.input.right', trigger !== undefined, JSON.stringify(registrations.map((r) => r.options.name)));
  check('按钮 id=prompt-polish-trigger 且 order=-10', trigger?.options.id === 'prompt-polish-trigger' && trigger?.options.order === -10, JSON.stringify(trigger?.options));
  // 交互改造：结果直接回显输入框，**不允许**再注册任何结果面板 / 浮层槽位
  const overlaySlots = ['conversation.input.dock', 'conversation.composer', 'conversation.input.activity'];
  check('只注册 input.right 一个输入区槽位（无结果面板）',
    registrations.filter((r) => r.options.name.startsWith('conversation.')).length === 1,
    JSON.stringify(registrations.map((r) => r.options.name)));
  check('没有注册任何浮层/面板槽位', overlaySlots.every((n) => registrations.every((r) => r.options.name !== n)),
    JSON.stringify(overlaySlots));
  check('注册了 plugins.bundle.config', configCard !== undefined, String(configCard !== undefined));
  check('设置卡片 key=包名 dsh-prompt-polish（否则插件页判定未配置）', configCard?.options.key === 'dsh-prompt-polish', String(configCard?.options.key));
  check('设置卡片包在 whileServed([prompt-polish]) 内', JSON.stringify(servedNamespaces) === JSON.stringify(['prompt-polish']), JSON.stringify(servedNamespaces));
  check('注册了 locale 字典且含 settings.* 扁平键', localeDumps['prompt-polish'] !== undefined && typeof localeDumps['prompt-polish'].zh['settings.enabled'] === 'string', JSON.stringify(Object.keys(localeDumps)));
  check('样式 <style> 已插入且带 data-plugin-css', styleTags.length === 1 && styleTags[0].dataset.pluginCss === 'dsh-prompt-polish/trigger.css', JSON.stringify(styleTags.map((t) => t.dataset)));

  group('15. 三处 id 逐字相等（第 29 项）');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const patchYml = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8');
  const patchId = (patchYml.match(/^\s*-\s*id:\s*(\S+)\s*$/m) || [])[1];
  const patchName = (patchYml.match(/^\s*name:\s*'?([^'\n]+)'?\s*$/m) || [])[1];
  const api = global.window.__PP_TEST_API__;
  check('patch id = 客户端 NS', patchId === 'prompt-polish' && api.NS === 'prompt-polish', patchId + ' / ' + api.NS);
  check('patch name = package.json name', patchName === pkgJson.name && patchName === 'dsh-prompt-polish', patchName + ' / ' + pkgJson.name);
  check('设置卡片 key = package.json name', configCard?.options.key === pkgJson.name, configCard?.options.key);

  return { api, controller, trigger, configCard, localeDumps, disposers, reset, runEffects, rewind, styleTags };
}

// ============ B2 段：组件行为（守卫链 / CAS / 撤回 / 热生效 / 错误文案）============
function baseConfig() {
  return { enabled: true, fixedProvider: '', fixedModel: '', temperature: 0.2, timeoutSeconds: 60, maxDraftChars: 8000, maxTokens: 0, lengthRatio: 2, allowPlaceholder: true };
}

function makeInputState(over) {
  return Object.assign({ draft: '', attachmentIds: [], draftRev: 5, phase: 'plain', occurrences: [] }, over || {});
}

async function behaviourChecks(session) {
  const { api, controller, trigger, configCard, reset, runEffects, rewind, styleTags, localeDumps } = session;
  const Button = trigger.Component;
  const Card = configCard.Component;

  // 每个用例都从干净的 store 开始，避免上一个用例的快照串味
  function freshStore() { api.stores.clear(); }

  /** 渲染按钮并返回两帧：first 是首帧（effect 未跑），settled 是 effect 跑完后的稳定帧 */
  function renderButton(state, actions, sessionId) {
    const sid = sessionId === undefined ? 's1' : sessionId;
    const props = { sessionId: sid, useInput: (sel) => sel(state), inputActions: actions };
    reset();
    const first = Button(props);
    runEffects();
    rewind();
    const settled = Button(props);
    return { first, settled, props };
  }

  function ariaDisabled(node) { return node === null || node === undefined ? 'NOT-RENDERED' : node.props['aria-disabled']; }

  // ---------- 按钮守卫链（第 4~10 项）----------
  group('16. 按钮守卫链（第 4~10 项）');
  freshStore();
  controller.set('enabled', true);

  const aEmpty = renderButton(makeInputState({ draft: '' }), makeInputActions(5, ''));
  check('4. 空草稿 → aria-disabled=true', ariaDisabled(aEmpty.settled) === 'true', String(ariaDisabled(aEmpty.settled)));
  check('4b. 纯空白草稿也视为空', ariaDisabled(renderButton(makeInputState({ draft: '   ' }), makeInputActions(5, '   ')).settled) === 'true', 'n/a');

  const aText = renderButton(makeInputState({ draft: '写个周报' }), makeInputActions(5, '写个周报'));
  check('5. 有草稿 → aria-disabled=false', ariaDisabled(aText.settled) === 'false', String(ariaDisabled(aText.settled)));
  // 追加悬停气泡后，按钮子节点变成 [图标, 气泡]：可见文字只允许来自气泡
  const childList = aText.settled !== null && Array.isArray(aText.settled.children) ? aText.settled.children : [];
  const iconEl = childList.find((c) => c !== null && typeof c.type === 'function' && c.props?.className !== 'pp-tip');
  const tipEl = childList.find((c) => c !== null && c.props?.className === 'pp-tip');
  check('5b. 纯图标：按钮可见文字只来自悬停气泡', textOf(aText.settled) === '增强提示词' && iconEl !== undefined, String(textOf(aText.settled)));
  const iconNode = iconEl !== undefined ? iconEl.type({}) : null;
  check('5b2. 图标渲染成 16px 内联 svg', iconNode !== null && iconNode.type === 'svg' && iconNode.props.width === 16 && iconNode.props.height === 16, JSON.stringify(iconNode && iconNode.props));
  check('5c. 纯图标：aria-label 承担可读名', typeof aText.settled?.props['aria-label'] === 'string' && aText.settled.props['aria-label'] !== '', String(aText.settled?.props['aria-label']));

  const aPhase = renderButton(makeInputState({ draft: '写个周报', phase: 'sending' }), makeInputActions(5, '写个周报'));
  check('6. phase !== plain 时禁用', ariaDisabled(aPhase.settled) === 'true', String(ariaDisabled(aPhase.settled)));
  check('6b. 禁用原因是「正在发送」而非「草稿为空」', aPhase.settled?.props.title !== aEmpty.settled?.props.title, String(aPhase.settled?.props.title));

  const aRefs = renderButton(makeInputState({ draft: '写个周报', occurrences: [{ start: 0, end: 1 }] }), makeInputActions(5, '写个周报'));
  check('7. 有引用芯片时禁用', ariaDisabled(aRefs.settled) === 'true', String(ariaDisabled(aRefs.settled)));

  const aAttach = renderButton(makeInputState({ draft: '', attachmentIds: ['f1'] }), makeInputActions(5, ''));
  check('8. 只有附件无文字时禁用', ariaDisabled(aAttach.settled) === 'true', String(ariaDisabled(aAttach.settled)));
  check('8b. 有附件又有文字时不禁用', ariaDisabled(renderButton(makeInputState({ draft: '看图', attachmentIds: ['f1'] }), makeInputActions(5, '看图')).settled) === 'false', 'n/a');

  const aLong = renderButton(makeInputState({ draft: 'x'.repeat(8001) }), makeInputActions(5, 'x'.repeat(8001)));
  check('9. 超长草稿（>8000 字）禁用', ariaDisabled(aLong.settled) === 'true', String(ariaDisabled(aLong.settled)));
  check('9b. 正好 8000 字不禁用（边界不提前触发）', ariaDisabled(renderButton(makeInputState({ draft: 'x'.repeat(8000) }), makeInputActions(5, 'x'.repeat(8000))).settled) === 'false', 'n/a');

  // 第 10 项：畸形 state 不抛错（宿主快照缺字段、旧版本字段名不同）
  let malformedThrew = null;
  try {
    renderButton(undefined, makeInputActions(5, ''));
    renderButton({}, makeInputActions(5, ''));
    renderButton({ draft: 123, phase: null, occurrences: null, attachmentIds: 'x' }, makeInputActions(5, ''));
    renderButton(makeInputState({ draft: 'a' }), undefined);
  } catch (e) { malformedThrew = e; }
  check('10. 缺字段 / 类型不对的畸形 state 不抛错', malformedThrew === null, String(malformedThrew && malformedThrew.message));

  // ---------- store 按会话隔离（第 11 项）----------
  group('17. 状态按 sessionId 隔离（第 11 项）');
  freshStore();
  api.setSnapshot('sA', { status: 'streaming', text: 'AAA' });
  api.setSnapshot('sB', { status: 'ready', text: 'BBB' });
  check('11. 两个会话各自独立', api.stores.get('sA').snapshot.text === 'AAA' && api.stores.get('sB').snapshot.text === 'BBB', 'A=' + api.stores.get('sA').snapshot.text + ' B=' + api.stores.get('sB').snapshot.text);
  check('11b. 写 A 不改 B 的 status', api.stores.get('sA').snapshot.status === 'streaming' && api.stores.get('sB').snapshot.status === 'ready', 'n/a');
  check('11c. 未碰过的会话读到 idle 快照（不是 undefined）', api.stores.get('sC') === undefined && (api.setSnapshot('sC', {}), api.stores.get('sC').snapshot.status === 'idle'), 'n/a');

  // ---------- 替换草稿 CAS（第 12、13、14 项）----------
  group('18. 替换草稿 CAS（第 12、13、14 项）');
  freshStore();
  const ia1 = makeInputActions(7, '旧草稿');
  const r1 = api.applyResult(ia1, '新草稿', 7, '旧草稿');
  check('12. rev 一致 → ok', r1.ok === true, JSON.stringify(r1));
  // 回归：TokenSpan 里没有 draft 字段，原文只能由调用方显式传入。
  // 早先实现从 span.draft 读，拿到恒为 undefined → original 存成空串 → 回退把输入框清空。
  check('12a. 原文来自显式传参（不是从 span 里读）', r1.ok === true && r1.original === '旧草稿', JSON.stringify(r1));
  check('12b. 用 setDraft 整体替换（不是 insertText 插入）', ia1.calls.setDraft.length === 1 && ia1.calls.setDraft[0] === '新草稿', JSON.stringify(ia1.calls.setDraft));
  check('12c. 绝不调用 insertText', ia1.calls.insertText === 0, String(ia1.calls.insertText));
  check('12d. 立刻 persistDraft 落盘', ia1.calls.persist === 1, String(ia1.calls.persist));
  check('14. captureInsertion 只调一次', ia1.calls.capture === 1, String(ia1.calls.capture));

  const ia2 = makeInputActions(9, '用户又改了');
  const r2 = api.applyResult(ia2, '新草稿', 7, '旧草稿');
  check('13. rev 不一致 → ok=false 且 reason=stale', r2.ok === false && r2.reason === 'stale', JSON.stringify(r2));
  check('13b. stale 时一个字符都不写', ia2.calls.setDraft.length === 0 && ia2.calls.persist === 0, JSON.stringify(ia2.calls));

  const ia3 = makeInputActions(7, '旧草稿');
  const r3 = api.applyResult(undefined, '新草稿', 7, '旧草稿');
  check('13c. inputActions 缺失 → ok=false 而不是抛错', r3.ok === false && r3.reason === 'no-input', JSON.stringify(r3));

  // ---------- 回退 / 恢复切换（需求 4、5，边界 1、4）----------
  group('19. 回退与恢复（同一个图标来回切换）');
  freshStore();
  // 场景：优化稿已在输入框里（draft === text），点一下应回到原文
  const iaT = makeInputActions(11, '改写稿');
  renderButton(makeInputState({ draft: '改写稿', draftRev: 11 }), iaT);
  api.setSnapshot('s1', { status: 'applied', text: '改写稿', original: '原文', showing: 'result', resultRev: 11 });
  const btnT = renderButton(makeInputState({ draft: '改写稿', draftRev: 11 }), iaT).settled;
  check('15a. 草稿仍是优化稿 → 图标进 applied 态（回转箭头）', btnT?.props['data-state'] === 'applied', String(btnT?.props['data-state']));
  check('15b. applied 态 aria-label 提示「回退」', btnT?.props['aria-label'] === '回退到优化前的提示词', String(btnT?.props['aria-label']));
  iaT.calls.setDraft.length = 0;
  if (btnT !== undefined) btnT.props.onClick();
  check('15c. 点一下把原文写回草稿（逐字一致）', iaT.calls.setDraft.length === 1 && iaT.calls.setDraft[0] === '原文', JSON.stringify(iaT.calls.setDraft));
  check('15d. 回退立刻落盘', iaT.calls.persist === 1, String(iaT.calls.persist));
  const afterRevert = api.stores.get('s1').snapshot;
  check('15e. 回退后仍在 applied 态且方向翻成 original（可再点回去）', afterRevert.status === 'applied' && afterRevert.showing === 'original', afterRevert.status + ' / ' + afterRevert.showing);

  // 第二次点击：输入框里现在是原文，应把优化稿写回去
  const iaT2 = makeInputActions(12, '原文');
  renderButton(makeInputState({ draft: '原文', draftRev: 12 }), iaT2);
  const btnT2 = renderButton(makeInputState({ draft: '原文', draftRev: 12 }), iaT2).settled;
  check('15f. 原文态 aria-label 提示「恢复」', btnT2?.props['aria-label'] === '恢复刚才的优化结果', String(btnT2?.props['aria-label']));
  iaT2.calls.setDraft.length = 0;
  if (btnT2 !== undefined) btnT2.props.onClick();
  check('15g. 再点一下把优化稿写回（来回切换成立）', iaT2.calls.setDraft.length === 1 && iaT2.calls.setDraft[0] === '改写稿', JSON.stringify(iaT2.calls.setDraft));
  check('15h. 方向翻回 result', api.stores.get('s1').snapshot.showing === 'result', String(api.stores.get('s1').snapshot.showing));

  // 边界 4：用户手改过草稿 → 图标退回星形，点击是「继续优化」而不是回退
  freshStore();
  const iaEdit = makeInputActions(13, '我自己改过的内容');
  renderButton(makeInputState({ draft: '我自己改过的内容', draftRev: 13 }), iaEdit);
  api.setSnapshot('s1', { status: 'applied', text: '改写稿', original: '原文', showing: 'result', resultRev: 11 });
  const btnEdit = renderButton(makeInputState({ draft: '我自己改过的内容', draftRev: 13 }), iaEdit).settled;
  check('15i. 草稿被改过 → 不再显示回退箭头，退回星形', btnEdit?.props['data-state'] === 'idle', String(btnEdit?.props['data-state']));
  check('15j. 改过之后 aria-label 回到「优化提示词」', btnEdit?.props['aria-label'] === '优化提示词', String(btnEdit?.props['aria-label']));
  check('15k. 改过之后按钮可点（不是禁用）', btnEdit?.props['aria-disabled'] === 'false', String(btnEdit?.props['aria-disabled']));

  // 边界 4 续：此时点下去必须**基于新草稿重新优化**，不能拿旧原文覆盖
  const realFetchToggle = global.fetch;
  let sentBody = null;
  global.fetch = async (url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response('data: ' + JSON.stringify({ type: 'done', text: '二改稿' }) + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  iaEdit.calls.setDraft.length = 0;
  if (btnEdit !== undefined) btnEdit.props.onClick();
  await new Promise((r) => setTimeout(r, 20));
  check('15l. 改过之后点击发的是新草稿（在此基础上继续优化）', sentBody !== null && sentBody.draft === '我自己改过的内容', JSON.stringify(sentBody));
  check('15m. 重新优化后草稿被换成新的改写稿', iaEdit.calls.setDraft.length === 1 && iaEdit.calls.setDraft[0] === '二改稿', JSON.stringify(iaEdit.calls.setDraft));
  global.fetch = realFetchToggle;

  // 边界 1 之二：改过之后「回退」必须拒绝，绝不冲掉用户刚打的字
  freshStore();
  const iaGuard = makeInputActions(21, '用户后来的字');
  renderButton(makeInputState({ draft: '用户后来的字', draftRev: 21 }), iaGuard);
  api.setSnapshot('s1', { status: 'applied', text: '改写稿', original: '原文', showing: 'result', resultRev: 11 });
  iaGuard.calls.setDraft.length = 0;
  api.toggle('s1', '用户后来的字');
  check('15n. 直接调 toggle 时草稿对不上 → 一个字符都不写', iaGuard.calls.setDraft.length === 0, JSON.stringify(iaGuard.calls.setDraft));
  // 15n2：不传实时草稿（undefined）时同样必须拒绝——宁可不动手，也不能拿猜的值覆盖
  const iaNoLive = makeInputActions(22, '随便');
  renderButton(makeInputState({ draft: '随便', draftRev: 22 }), iaNoLive);
  api.setSnapshot('s1', { status: 'applied', text: '改写稿', original: '原文', showing: 'result', resultRev: 11 });
  iaNoLive.calls.setDraft.length = 0;
  api.toggle('s1');
  check('15n2. 未传实时草稿 → 一律拒绝（不猜）', iaNoLive.calls.setDraft.length === 0, JSON.stringify(iaNoLive.calls.setDraft));
  check('15o. 拒绝时图标进 error 态（红一下自动复原）', api.stores.get('s1').snapshot.status === 'error', String(api.stores.get('s1').snapshot.status));
  // ---------- 设置热生效（第 26 项 + 验收项 9）----------
  group('20. 设置热生效（第 26 项）');
  freshStore();
  controller.set('enabled', true);
  const beforeOff = renderButton(makeInputState({ draft: '写个周报' }), makeInputActions(5, '写个周报'));
  check('26a. 开关打开时按钮在', beforeOff.settled !== null, String(beforeOff.settled === null));
  controller.set('enabled', false);
  const afterOff = renderButton(makeInputState({ draft: '写个周报' }), makeInputActions(5, '写个周报'));
  check('26b. 关掉总开关后按钮立刻消失（不重启）', afterOff.settled === null, String(afterOff.settled));
  controller.set('enabled', true);
  const backOn = renderButton(makeInputState({ draft: '写个周报' }), makeInputActions(5, '写个周报'));
  check('26c. 再打开又回来（同一进程内双向生效）', backOn.settled !== null, String(backOn.settled === null));

  // ---------- 设置卡片三态（第 26 项补充）----------
  group('21. 设置卡片三态与空值处理');
  const snapReady = controller.getSnapshot();
  controller.getSnapshot = () => ({ status: 'loading', value: undefined, writable: true, revision: undefined });
  reset(); const cardLoading = Card({}); runEffects(); rewind();
  check('21a. loading 态渲染出加载文案（不白屏）', textOf(cardLoading) !== '' && textOf(cardLoading) !== 'settings.loading', textOf(cardLoading).slice(0, 40));
  controller.getSnapshot = () => ({ status: 'unavailable', value: undefined, writable: true, revision: undefined });
  reset(); const cardUnavail = Card({}); runEffects(); rewind();
  check('21b. unavailable 态渲染出说明文案', textOf(cardUnavail) !== '' && textOf(cardUnavail) !== 'settings.unavailable', textOf(cardUnavail).slice(0, 40));
  controller.getSnapshot = () => snapReady;
  const writes = controller.writes;
  writes.length = 0;
  /**
   * 展开函数组件（一帧）。桩 createElement 只造 {type,props,children}，
   * 遇到函数组件不会自动执行，所以断言内部控件前必须手动展开一层。
   * 连续调用时不清 hook 槽：第二帧正好复用第一帧的 useState，用来测「输入 → 失焦」两阶段。
   */
  function expandOnce(node) {
    if (node === null || node === undefined || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(expandOnce);
    if (typeof node.type === "function") return expandOnce(node.type(node.props || {}));
    return Object.assign({}, node, { children: expandOnce(node.children) });
  }

  reset();
  const cardReady = expandOnce(Card({}));
  runEffects();
  rewind();
  const inputs = findAll(cardReady, (n) => n.type === "input");
  const selects = findAll(cardReady, (n) => n.type === "select");
  // 1 个总开关 + 5 个数字框 + 1 个占位符开关 = 7 个 input；服务商与模型各一个 select
  check("21c. ready 态渲染出 7 个 input + 2 个下拉（共 9 个控件）",
    inputs.length === 7 && selects.length === 2, inputs.length + " input / " + selects.length + " select");
  check("21c2. 数字框数量为 5（温度/超时/草稿上限/输出上限/长度倍数）",
    inputs.filter((n) => n.props.type === "number").length === 5,
    String(inputs.filter((n) => n.props.type === "number").length));
  check("21c3. 两个下拉都带「跟随会话当前模型」空选项",
    selects.every((n) => Array.isArray(n.children) && n.children[0] !== undefined && n.children[0].props.value === ""),
    JSON.stringify(selects.map((n) => n.children && n.children.length)));

  // 数字框两阶段：第一帧输入只改本地草稿，第二帧失焦才提交
  writes.length = 0;
  reset();
  const frame1 = expandOnce(Card({}));
  const num1 = findAll(frame1, (n) => n.type === "input" && n.props.type === "number")[0];
  if (num1 !== undefined) {
    num1.props.onChange({ target: { value: "" } });
    check("21d. 输入期间不写配置（本地草稿态，修掉「删一个字符不生效」）", writes.length === 0, JSON.stringify(writes));
    rewind();
    const frame2 = expandOnce(Card({}));
    const num2 = findAll(frame2, (n) => n.type === "input" && n.props.type === "number")[0];
    num2.props.onBlur();
    check("21e. 失焦清空走 unset 而不是 set(0)", writes.length === 1 && writes[0][0] === "unset", JSON.stringify(writes));

    // 越界值必须给提示，不能像旧实现那样静默 return
    writes.length = 0;
    reset();
    const frame3 = expandOnce(Card({}));
    const num3 = findAll(frame3, (n) => n.type === "input" && n.props.type === "number")[0];
    num3.props.onChange({ target: { value: "999999" } });
    rewind();
    const frame4 = expandOnce(Card({}));
    findAll(frame4, (n) => n.type === "input" && n.props.type === "number")[0].props.onBlur();
    // 越界提示由 onBlur 里的 setWarn 写入 hook 槽，已生成的 frame4 不会自动重渲染，
    // 所以必须再 rewind + 展开一帧才能读到提示文本。
    rewind();
    const frame5 = expandOnce(Card({}));
    check("21f. 越界值不写配置且渲染出提示", writes.length === 0 && textOf(frame5).includes("超出允许范围"), JSON.stringify(writes) + " / " + textOf(frame5).slice(0, 120));
  } else {
    check("21d. 找到数字框", false, "未找到 number input");
  }

  // ---------- 请求失败文案（第 32 项）----------
  group('22. 错误文案（第 32 项）');
  const realFetch = global.fetch;
  function stubFetch(status, body) {
    global.fetch = async () => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  function stubStream(frames) {
    global.fetch = async () => new Response(frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  freshStore();
  const iaErr = makeInputActions(5, '写个周报');
  renderButton(makeInputState({ draft: '写个周报' }), iaErr);
  stubFetch(403, { error: { code: 'http-403', message: 'disabled' } });
  await api.start('s1', '写个周报');
  const snap403 = api.stores.get('s1').snapshot;
  check('32. 403 落「已在设置中关闭」而不是 HTTP 403', snap403.status === 'error' && snap403.error === '已在设置中关闭提示词优化', snap403.status + ' / ' + snap403.error);

  stubFetch(429, { error: { code: 'http-429', message: 'busy' } });
  await api.start('s1', '写个周报');
  const snap429 = api.stores.get('s1').snapshot;
  check('24. 429 落 error 而不是卡在 loading', snap429.status === 'error' && snap429.error.includes('太多'), snap429.status + ' / ' + snap429.error);

  stubFetch(409, { error: { code: 'http-409', message: 'dup' } });
  await api.start('s1', '写个周报');
  check('24b. 409 落「正在优化中」', api.stores.get('s1').snapshot.error === '这个会话正在优化中，请稍候', String(api.stores.get('s1').snapshot.error));

  stubStream([{ type: 'start', provider: 'p', model: 'm', source: 'default' }, { type: 'delta', text: '改写' }, { type: 'done', text: '改写稿' }]);
  await api.start('s1', '写个周报');
  const snapOk = api.stores.get('s1').snapshot;
  check('23. 正常流直接落 applied 并写回输入框（无面板）', snapOk.status === 'applied' && snapOk.text === '改写稿' && snapOk.model === 'm', snapOk.status + ' / ' + snapOk.text + ' / ' + snapOk.model);
  check('23a2. 结果已写进草稿且记录了原文', iaErr.calls.setDraft.length === 1 && iaErr.calls.setDraft[0] === '改写稿' && snapOk.original === '写个周报', JSON.stringify(iaErr.calls.setDraft) + ' / original=' + snapOk.original);
  check('23a3. 完成后 showing=result', snapOk.showing === 'result', String(snapOk.showing));
  check('23b. resultRev 记录发起时的 draftRev（供 stale 判定）', snapOk.resultRev === 5, String(snapOk.resultRev));

  stubStream([{ type: 'error', message: '上游炸了' }]);
  await api.start('s1', '写个周报');
  check('23c. 服务端 error 事件落 error 态', api.stores.get('s1').snapshot.status === 'error', String(api.stores.get('s1').snapshot.status));

  global.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  await api.start('s1', '写个周报');
  check('23d. 用户取消（AbortError）回到 idle，不显示错误', api.stores.get('s1').snapshot.status === 'idle', String(api.stores.get('s1').snapshot.status));
  global.fetch = realFetch;

  // ---------- 连点防护（验收项 14）----------
  group('23. 连点防护（验收项 14）');
  freshStore();
  const iaClick = makeInputActions(5, '写个周报');
  const btn = renderButton(makeInputState({ draft: '写个周报' }), iaClick).settled;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return new Response('data: ' + JSON.stringify({ type: 'done', text: 'ok' }) + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  btn.props.onClick();
  btn.props.onClick();
  btn.props.onClick();
  btn.props.onClick();
  btn.props.onClick();
  await new Promise((r) => setTimeout(r, 20));
  check('14. 连点 5 下只发 1 个请求', fetchCalls === 1, String(fetchCalls));
  global.fetch = realFetch;

  // ---------- 悬停气泡（追加需求：图标 + 悬停「增强提示词」）----------
  group('24. 悬停气泡（追加需求）');
  freshStore();
  controller.set('enabled', true);
  function tipOf(node) {
    if (node === null || node === undefined) return 'NOT-RENDERED';
    const kids = Array.isArray(node.children) ? node.children : [];
    const el = kids.find((c) => c !== null && c.props?.className === 'pp-tip');
    return el === undefined ? 'NO-TIP' : textOf(el);
  }
  const tIdle = renderButton(makeInputState({ draft: '写个周报' }), makeInputActions(5, '写个周报'));
  check('24a. 常态悬停文案逐字是「增强提示词」', tipOf(tIdle.settled) === '增强提示词', tipOf(tIdle.settled));
  check('24b. 气泡带 role=tooltip（读屏可达）', (() => {
    const kids = Array.isArray(tIdle.settled?.children) ? tIdle.settled.children : [];
    const el = kids.find((c) => c !== null && c.props?.className === 'pp-tip');
    return el !== undefined && el.props.role === 'tooltip';
  })(), 'n/a');
  check('24c. 气泡不接收鼠标事件（不挡点击）', (() => {
    const kids = Array.isArray(tIdle.settled?.children) ? tIdle.settled.children : [];
    const el = kids.find((c) => c !== null && c.props?.className === 'pp-tip');
    return el !== undefined && el.props['aria-hidden'] !== 'true';
  })(), 'n/a');

  // 显隐完全由 CSS :hover / :focus-visible 控制，源码里必须同时有这两条规则
  const cssText = styleTags[0]?.textContent ?? '';
  check('24d. CSS 里有 :hover 显示规则（移开即消失，无 JS 延迟）',
    /\.pp-trigger:hover \.pp-tip/.test(cssText) && /\.pp-trigger:focus-visible \.pp-tip/.test(cssText), 'n/a');
  check('24e. 气泡默认 display:none（不悬停时零占位）', /\.pp-tip\{[^}]*display:none/.test(cssText), 'n/a');
  check('24f. 气泡用官方 tooltip 令牌（浅深主题都跟着变）',
    cssText.includes('--dsw-alias-tooltip-bg') && cssText.includes('--dsw-alias-tooltip-label'), 'n/a');
  check('24g. 气泡绝对定位，不挤动输入栏布局', /\.pp-tip\{[^}]*position:absolute/.test(cssText), 'n/a');

  // 状态切换时文案跟着换，避免「悬停转圈却写着增强提示词」
  api.setSnapshot('s1', { status: 'loading' });
  const tBusy = renderButton(makeInputState({ draft: '写个周报' }), makeInputActions(5, '写个周报'));
  check('24h. 生成中气泡改「取消优化」', tipOf(tBusy.settled) === '取消优化', tipOf(tBusy.settled));
  api.setSnapshot('s1', { status: 'applied', text: '改写稿', original: '原文', showing: 'result' });
  const tApplied = renderButton(makeInputState({ draft: '改写稿', draftRev: 5 }), makeInputActions(5, '改写稿'));
  check('24i. 回退态气泡改「回退到原文」', tipOf(tApplied.settled) === '回退到原文', tipOf(tApplied.settled));
  api.setSnapshot('s1', { status: 'applied', text: '改写稿', original: '原文', showing: 'original' });
  const tBack = renderButton(makeInputState({ draft: '原文', draftRev: 5 }), makeInputActions(5, '原文'));
  check('24j. 恢复态气泡改「恢复优化结果」', tipOf(tBack.settled) === '恢复优化结果', tipOf(tBack.settled));

  // 边界：草稿为空时气泡要说原因，不能还是「增强提示词」
  freshStore();
  const tEmptyTip = renderButton(makeInputState({ draft: '' }), makeInputActions(5, ''));
  check('24k. 草稿为空时气泡显示「先输入内容」', tipOf(tEmptyTip.settled) === '先输入内容', tipOf(tEmptyTip.settled));
  check('24l. 空草稿仍不渲染面板/浮层（只有按钮与气泡）',
    Array.isArray(tEmptyTip.settled?.children) && tEmptyTip.settled.children.length === 2, String(tEmptyTip.settled?.children?.length));

  // 英文环境：气泡跟随语言包，但中文文案必须仍是「增强提示词」
  check('24m. 中文词典里 tipEnhance 逐字等于「增强提示词」', localeDumps['prompt-polish'].zh.tipEnhance === '增强提示词', String(localeDumps['prompt-polish'].zh.tipEnhance));
  check('24n. 英文词典也有 tipEnhance（不缺键退化成 key 原文）', typeof localeDumps['prompt-polish'].en.tipEnhance === 'string' && localeDumps['prompt-polish'].en.tipEnhance !== 'tipEnhance', String(localeDumps['prompt-polish'].en.tipEnhance));
  // 收尾：把总开关复位，避免影响后续断言
  controller.set('enabled', true);
}

// ============ 主流程 ============
async function main() {
  console.log('dsh-prompt-polish 离线自检（设计文档 7.1 的 32 项）');
  console.log('node ' + process.version + ' / ' + ROOT);

  const host = await hostChecks();
  await handlerChecks(host.handle);
  const session = await clientChecks();
  await behaviourChecks(session);

  console.log('\n========================================');
  if (failures.length === 0) {
    console.log('结论：全部通过（' + passed + ' 项断言）');
    process.exit(0);
  }
  console.log('结论：失败 ' + failures.length + ' 项 / 通过 ' + passed + ' 项');
  for (const f of failures) console.log('  - ' + f.label + (f.detail === undefined ? '' : '  <- ' + f.detail));
  process.exit(1);
}

main().catch((err) => {
  console.error('自检自身崩溃：', err);
  process.exit(1);
});
