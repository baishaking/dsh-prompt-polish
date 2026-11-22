window.__ModuleLoader__.load({
  id: 'dsh-prompt-polish',
  factory(require) {
    const React = require('react')

    // ===== 常量 =====
    // 命名空间 = Host 插件条目 id = configForms.get 的 entryId = cordis.patch.yml 的 id。
    // ⚠️ 写成包名 dsh-prompt-polish 会让 configForms.get() 永远 unavailable、whileServed 永不触发，
    //    整块设置卡片静默消失且没有任何报错（dsh-settings/src/index.ts:310/315/327 用 entry.options.id）。
    const NS = 'prompt-polish'
    const PKG = 'dsh-prompt-polish'   // keyed 槽位按包名分格，必须等于 package.json 的 name
    const ROUTE = '/api/prompt-polish/polish'
    const STYLE_ID = 'dsh-prompt-polish/trigger.css'
    const MAX_DRAFT = 8000

    // ===== 样式 =====
    // 用主题令牌而不是写死颜色：暗色主题下写死 #fff 会白底白字（复核建议 14）
    const CSS = [
      // 全部使用 dsh-client-ui-theme/src/styles/design-platform.css 里真实存在的 --dsw-* 变量。
      // ⚠️ 曾用 --dsw-alias-bg-primary / -border-secondary / -label-danger 等**不存在的名字**，
      //    兜底值 #fff 生效，深色主题下面板变白底、浅灰字压白底完全看不见。
      // 交互改造后不再有结果面板，图标本身承载 优化 / 转圈 / 回退 / 出错 四态。
      '.pp-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.pp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.pp-trigger:active{background:var(--dsw-alias-interactive-bg-active)}',
      '.pp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color);outline-offset:1px}',
      // 回退态：图标换成回转箭头并带强调色，让「再点一下会撤掉」一眼可见
      '.pp-trigger[data-state="applied"]{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}',
      '.pp-trigger[data-state="applied"]:hover{background:var(--dsw-alias-interactive-bg-hover-accent)}',
      // 出错态：只有颜色变化，不新增任何浮层
      '.pp-trigger[data-state="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.pp-trigger[aria-disabled="true"]{opacity:.45;cursor:not-allowed}',
      '.pp-trigger[aria-disabled="true"]:hover{background:transparent;color:var(--dsw-alias-label-tertiary)}',
      // 转圈画在图标自己的位置上：同尺寸圆形，不占额外区域
      '.pp-spinner{display:block;width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l4);border-top-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);animation:pp-spin .7s linear infinite}',
      '@keyframes pp-spin{to{transform:rotate(360deg)}}',
      '.pp-config{display:flex;flex-direction:column}',
      '.pp-row{display:flex;align-items:center;gap:16px;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.pp-row:last-child{border-bottom:0}',
      '.pp-row-label{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}',
      '.pp-row-hint{display:block;color:var(--dsw-alias-label-caption);font-size:12px;line-height:16px;margin-top:2px}',
      '.pp-input{flex:0 0 auto;width:240px;max-width:60%;box-sizing:border-box;height:28px;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 8px;font-size:13px;outline:none;transition:border-color .12s ease}',
      '.pp-input:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}',
      '.pp-input[disabled]{opacity:.5;cursor:not-allowed}',
      '.pp-config input[type="checkbox"]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);cursor:pointer}',
      // 下拉与数字框容器：宽度与 pp-input 一致，出错时错误行贴在控件下方而不是撑满整行
      // flex:0 0 auto 必须写：行容器是 flex，默认 flex-shrink:1 会把 200px 的下拉框压成几十像素，文字被截断
      '.pp-select-wrap,.pp-num-wrap{display:flex;flex-direction:column;gap:2px;flex:0 0 auto;width:240px;max-width:60%}',
      '.pp-select-wrap .pp-input,.pp-num-wrap .pp-input{width:100%;max-width:none}',
      // 原生 select 在深色主题下会画出白底下拉，必须显式给 appearance:none + 自绘箭头
      '.pp-select{appearance:none;-webkit-appearance:none;padding-right:24px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 14px) 12px,calc(100% - 9px) 12px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer}',
      // 下拉展开的选项由浏览器绘制，只能用 color-scheme 让它跟随深浅色
      '.pp-select option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.pp-cfg-error{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:2px 0}',
      '.pp-cfg-ok{color:var(--dsw-alias-label-caption);font-size:12px;padding:2px 0}',
      // 悬停气泡：照 workbuddy 参考图（深灰底 / 白字 / 圆角 / 下方小三角），
      // 用官方 tooltip 令牌，浅色深色自动跟随（design-platform.css:302-304 与 456-458 两段都有定义）
      '.pp-tip{position:absolute;bottom:calc(100% + 9px);left:50%;transform:translateX(-50%);z-index:30;display:none;align-items:center;white-space:nowrap;padding:5px 10px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-tooltip-label);font-size:12px;line-height:16px;font-weight:400;letter-spacing:0;box-shadow:0 4px 12px rgba(0,0,0,.18);pointer-events:none}',
      // 小三角用旋转方块画：只显示朝下的那一半，深色下与气泡同色，不留缝
      '.pp-tip::after{content:"";position:absolute;top:100%;left:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:1px;background:inherit;transform:rotate(45deg)}',
      '.pp-trigger:hover .pp-tip,.pp-trigger:focus-visible .pp-tip{display:flex}',
    ].join('\n')

    /** 注入 <style>；返回卸载函数。dataset.pluginCss 供重复装载时判重（照范本写法） */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = PKG
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    // ===== 字典 =====
    const ZH = {
      title: '优化提示词',
      tipEnhance: '增强提示词',
      tipCancel: '取消优化',
      tipRevert: '回退到原文',
      tipRestore: '恢复优化结果',
      cancelHint: '正在优化，点击取消',
      revertHint: '回退到优化前的提示词',
      restoreHint: '恢复刚才的优化结果',
      reasonSending: '正在发送，稍候',
      reasonQuotes: '草稿里有引用，先移除再优化',
      reasonOnlyAttach: '只有附件，没有文字可优化',
      reasonEmpty: '先输入内容',
      reasonTooLong: '草稿太长（超过 8000 字）',
      reasonBusy: '正在优化…',
      reasonDraftChanged: '草稿已改动，结果未替换',
      reasonNoInput: '输入框状态尚未就绪，请重试',
      'settings.title': '提示词优化',
      'settings.loading': '正在读取配置…',
      'settings.unavailable': '插件未启用，配置不可用',
      'settings.readonly': '当前配置不可写',
      'settings.saved': '已保存',
      'settings.refused': '写入被拒绝',
      'settings.enabled': '启用优化按钮',
      'settings.enabledHint': '关掉后输入框旁的图标消失，接口返回 403',
      'settings.fixedProvider': '固定模型 · 服务商',
      'settings.fixedModel': '固定模型 · 模型名',
      'settings.fixedHint': '留空＝跟随会话当前模型；选服务商后模型列表随之变化',
      'settings.followSession': '跟随会话当前模型',
      'settings.notNumber': '请填数字',
      'settings.outOfRange': '超出允许范围：',
      'settings.catalogFailed': '模型目录加载失败：',
      'settings.temperature': '温度',
      'settings.temperatureHint': '0~1，越小越保守（几乎只补标点、少换词），越大越敢重写；改写提示词建议 0.2~0.4',
      'settings.timeoutSeconds': '超时（秒）',
      'settings.timeoutHint': '10~300，超时自动中止，默认 60',
      'settings.maxDraftChars': '草稿长度上限（字）',
      'settings.maxDraftHint': '500~20000，超过直接拒绝不截断，默认 8000',
      'settings.maxTokens': '输出 token 上限',
      'settings.maxTokensHint': '0＝按草稿长度自动估算；填了就用它，但不会超过模型自身上限（当前模型上限见下方提示）',
      'settings.lengthRatio': '长度倍数上限',
      'settings.lengthRatioHint': '1~3，改写稿最多是原文的几倍，默认 2；调小可减少被截断',
      'settings.allowPlaceholder': '允许占位符',
      'settings.allowPlaceholderHint': '关掉后禁止插入「（待补充：…）」，信息不足按默认理解写',
    }
    const EN = {
      title: 'Polish prompt',
      tipEnhance: 'Enhance prompt',
      tipCancel: 'Cancel polishing',
      tipRevert: 'Revert to original',
      tipRestore: 'Restore polished result',
      cancelHint: 'Polishing — click to cancel',
      revertHint: 'Revert to the original prompt',
      restoreHint: 'Restore the polished result',
      reasonSending: 'Sending, please wait',
      reasonQuotes: 'Remove quoted references first',
      reasonOnlyAttach: 'Only attachments, nothing to polish',
      reasonEmpty: 'Type something first',
      reasonTooLong: 'Draft is too long (over 8000 characters)',
      reasonBusy: 'Polishing…',
      reasonDraftChanged: 'Draft changed, result not applied',
      reasonNoInput: 'Composer is not ready yet, try again',
      'settings.title': 'Prompt polish',
      'settings.loading': 'Loading configuration…',
      'settings.unavailable': 'Plugin is not enabled; configuration unavailable',
      'settings.readonly': 'Configuration is read-only',
      'settings.saved': 'Saved',
      'settings.refused': 'Write refused',
      'settings.enabled': 'Enable polish button',
      'settings.enabledHint': 'When off the icon disappears and the route answers 403',
      'settings.fixedProvider': 'Fixed model · provider',
      'settings.fixedModel': 'Fixed model · model',
      'settings.fixedHint': 'Empty = follow the session model; picking a provider narrows the model list',
      'settings.followSession': 'Follow the session model',
      'settings.notNumber': 'Enter a number',
      'settings.outOfRange': 'Out of range: ',
      'settings.catalogFailed': 'Model catalog failed to load: ',
      'settings.temperature': 'Temperature',
      'settings.temperatureHint': '0~1; lower stays closer to your wording, higher rewrites more freely. 0.2~0.4 suits prompt polishing',
      'settings.timeoutSeconds': 'Timeout (seconds)',
      'settings.timeoutHint': '10~300, aborts automatically, default 60',
      'settings.maxDraftChars': 'Draft length limit (characters)',
      'settings.maxDraftHint': '500~20000, longer drafts are rejected, default 8000',
      'settings.maxTokens': 'Output token limit',
      'settings.maxTokensHint': '0 = estimate from draft length; a value here is used but still capped by the model limit',
      'settings.lengthRatio': 'Length ratio cap',
      'settings.lengthRatioHint': '1~3, at most how many times the original, default 2; lower it if output gets truncated',
      'settings.allowPlaceholder': 'Allow placeholders',
      'settings.allowPlaceholderHint': 'When off the model must not insert (TBD: …)',
    }
    // ===== 状态仓库 =====
    // 模块作用域，每个浏览器标签各持一份（跨标签不共享，这是既定事实，靠宿主侧 sessionId 去重兜底）
    const stores = new Map()   // sessionId -> { snapshot, listeners }
    const inflight = new Map() // sessionId -> AbortController
    const seqOf = new Map()    // sessionId -> 最新请求序号，防旧帧覆盖新帧
    const inputRefs = new Map()// sessionId -> InputActions

    // 交互改造后只有四态，全部体现在图标上，不再有结果面板：
    //   idle（可优化）/ loading（图标位置转圈）/ applied（图标变回退箭头）/ error（图标变红，几秒后自回 idle）
    const IDLE = {
      status: 'idle',
      text: '',        // 优化后的文本（applied 时草稿里就是它）
      original: '',    // 优化前的原文（回退用，必须逐字保留）
      // applied 态下输入框里此刻装的是哪一份：'result' 优化稿 / 'original' 原文。
      // 同一个图标反复点就在这两份之间来回换，靠它判断「下一次该写哪份」。
      showing: 'result',
      resultRev: null, // 应用时的 draftRev，供回退前复核草稿没被换过
      model: null,
      error: null,
    }

    // 出错只让图标变红几秒再自动复原，不做任何浮层；原因挂在按钮 title 上
    const errorTimers = new Map() // sessionId -> timeout id
    const ERROR_LINGER_MS = 8000

    // apply() 里把 locale 的 t 挂上来：start/revert 是模块级函数，拿不到组件作用域的 t
    let translate = (key) => key

    function storeFor(sessionId) {
      let s = stores.get(sessionId)
      if (s === undefined) {
        // 首渲染必须拿到确定的快照对象：返回 undefined 会让组件里 state.status 直接 TypeError
        s = { snapshot: IDLE, listeners: new Set() }
        stores.set(sessionId, s)
      }
      return s
    }

    function setSnapshot(sessionId, next) {
      const s = storeFor(sessionId)
      s.snapshot = { ...s.snapshot, ...next }
      for (const fn of s.listeners) fn()
    }

    function registerInput(sessionId, inputActions) {
      if (inputActions === undefined || inputActions === null) inputRefs.delete(sessionId)
      else inputRefs.set(sessionId, inputActions)
    }

    /**
     * 读当前草稿版本号。
     * ⚠️ InputActions 上没有 state 属性（input.ts:264-293），草稿版本号只能从
     *    captureInsertion() 返回的 TokenSpan 上读（draftRev 字段，input.ts:312）。
     */
    function draftRevOf(sessionId) {
      const actions = inputRefs.get(sessionId)
      if (actions === undefined) return null
      try { return actions.captureInsertion()?.draftRev ?? null } catch { return null }
    }

    // ⚠️ 不要试图从 captureInsertion() 的返回值里读草稿文本：
    //    TokenSpan 只有 start / end / draftRev 三个字段（draft-editor.ts:8-12），没有 draft。
    //    草稿文本一律由组件用 props.useInput 订阅后传进来。

    function describeError(err) {
      const msg = String(err?.message ?? err)
      if (msg.includes('HTTP 403')) return '已在设置中关闭提示词优化'
      if (msg.includes('HTTP 409')) return '这个会话正在优化中，请稍候'
      if (msg.includes('HTTP 429')) return '同时优化的请求太多，请稍后再试'
      if (msg.includes('HTTP 413')) return '草稿超过了设置里的长度上限'
      if (msg.includes('HTTP 503')) return '没有可用的模型，请先在设置里固定一个模型'
      if (msg.includes('HTTP 415')) return '请求格式异常，请重试'
      return msg
    }

    function clearError(sessionId) {
      const timer = errorTimers.get(sessionId)
      if (timer !== undefined) { clearTimeout(timer); errorTimers.delete(sessionId) }
    }

    /** 把错误挂到图标上，ERROR_LINGER_MS 后自动复原（用户不用手动关掉任何东西） */
    function flashError(sessionId, message) {
      clearError(sessionId)
      setSnapshot(sessionId, { status: 'error', error: message, text: '', original: '', resultRev: null })
      const timer = setTimeout(() => {
        errorTimers.delete(sessionId)
        // 期间用户可能已经重新发起优化，只有仍停在 error 态才复原
        if (storeFor(sessionId).snapshot.status === 'error') setSnapshot(sessionId, { ...IDLE })
      }, ERROR_LINGER_MS)
      errorTimers.set(sessionId, timer)
    }

    async function start(sessionId, draft) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      const actions = inputRefs.get(sessionId)
      // 输入框还没登记时直接放弃：没有 setDraft 通道，就算拿到结果也写不回去
      if (actions === undefined) return
      clearError(sessionId)
      // 同步置 loading：必须在 fetch 之前，否则连点两下会发两个请求
      setSnapshot(sessionId, { status: 'loading', text: '', original: '', resultRev: null, error: null })

      // 先 abort 同一会话上一次的请求：只 set 不 abort 的话，用户「取消→立刻再点」时
      // 前一个 reader 还在跑，两个 setSnapshot 交替写同一份快照
      const previous = inflight.get(sessionId)
      if (previous !== undefined) previous.abort()
      const controller = new AbortController()
      inflight.set(sessionId, controller)

      const seq = (seqOf.get(sessionId) ?? 0) + 1
      seqOf.set(sessionId, seq)
      const stillLatest = () => seqOf.get(sessionId) === seq
      // 发起时的草稿版本号：结果写回前要拿它复核，用户中途改过字就不能覆盖
      const startedRev = draftRevOf(sessionId)

      let text = ''
      let model = null
      let finished = false

      try {
        const res = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draft, sessionId }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => null)
          const message = detail?.error?.message
          throw new Error(typeof message === 'string' ? 'HTTP ' + res.status + ' ' + message : 'HTTP ' + res.status)
        }
        // ⚠️ res.body 可能为 null，不判空会抛在用户看不见的地方
        if (res.body === null) throw new Error('响应没有 body（宿主未返回流）')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // 帧解析必须用 buffer 累积：一次 read() 不保证是整帧，TCP 会把帧切开
          let cut = buffer.indexOf('\n\n')
          while (cut !== -1) {
            const frame = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            const line = frame.split('\n').find((l) => l.startsWith('data:'))
            if (line !== undefined) {
              let event = null
              try { event = JSON.parse(line.slice(5).trim()) } catch { event = null }
              if (event !== null) {
                if (!stillLatest()) { try { await reader.cancel() } catch { /* 已关闭 */ } return }
                if (event.type === 'start') {
                  model = typeof event.model === 'string' ? event.model : null
                } else if (event.type === 'delta') {
                  // 不再逐帧写快照：没有面板要显示中间态，少一次渲染就少一次抖动
                  text += typeof event.text === 'string' ? event.text : ''
                } else if (event.type === 'done') {
                  finished = true
                  // 以服务端剥洗后的整段为准，丢弃前面累积的 delta（delta 带围栏，done 已剥净）
                  text = typeof event.text === 'string' ? event.text : text
                } else if (event.type === 'error') {
                  finished = true
                  throw new Error(String(event.message ?? '优化失败'))
                }
              }
            }
            cut = buffer.indexOf('\n\n')
          }
          if (finished) break
        }
        if (!finished) throw new Error('连接意外结束，请重试')
        if (!stillLatest()) return

        // 写回输入框：applyResult 内部用 draftRev 做 CAS，草稿被改过就一个字符都不写
        const applied = applyResult(actions, text, startedRev, draft)
        if (!applied.ok) {
          setSnapshot(sessionId, { ...IDLE })
          flashError(sessionId, applied.reason === 'stale'
            ? translate('reasonDraftChanged')
            : translate('reasonNoInput'))
          return
        }
        setSnapshot(sessionId, {
          status: 'applied', text, original: applied.original, showing: 'result',
          resultRev: startedRev, model, error: null,
        })
      } catch (err) {
        // 只有「还是最新那次请求」才允许改快照：旧请求 abort 后 late-reject 的 AbortError
        // 会把新请求刚置好的 loading 打回 idle，用户看到图标不转了但结果还没来
        if (!stillLatest()) return
        if (err?.name === 'AbortError') setSnapshot(sessionId, { ...IDLE })
        else flashError(sessionId, describeError(err))
      } finally {
        // ⚠️ 只能删自己的 controller：新请求已 set 了新的，无条件 delete 会把新的抹掉
        if (inflight.get(sessionId) === controller) inflight.delete(sessionId)
      }
    }

    /**
     * 在「优化稿」与「原文」之间切换（同一个图标连点就在这两份之间来回）。
     * ⚠️ 只在 applied 态可调，且必须复核输入框里装的**正是**我们上一次写进去的那份：
     *    用户中途手改过草稿时一律不动手，只闪一次错误，绝不冲掉他刚打的字。
     */
    function toggle(sessionId, liveDraft) {
      const snap = storeFor(sessionId).snapshot
      if (snap.status !== 'applied') return
      const actions = inputRefs.get(sessionId)
      if (actions === undefined) { flashError(sessionId, translate('reasonNoInput')); return }

      const showingResult = snap.showing !== 'original'
      const expected = showingResult ? snap.text : snap.original
      const live = typeof liveDraft === 'string' ? liveDraft : null
      // 第二道防线：组件已经用实时 draft 判过一次，这里再按真实草稿复核。
      // 对不上说明点在「改字」与「点击」的同一帧之间，此时宁可不动手，也不冲掉用户刚打的字。
      if (live !== expected) { flashError(sessionId, translate('reasonDraftChanged')); return }

      const next = showingResult ? snap.original : snap.text
      clearError(sessionId)
      actions.setDraft(next)
      actions.persistDraft()
      // 留在 applied 态，只翻转方向：这样再点一次就能换回去（需求「多次点击可来回切换」）
      setSnapshot(sessionId, { showing: showingResult ? 'original' : 'result', error: null })
    }
    function cancel(sessionId) {
      const controller = inflight.get(sessionId)
      if (controller !== undefined) controller.abort()
    }

    const actions = { start, cancel, toggle }

    function usePolishState(sessionId) {
      const s = storeFor(sessionId)
      // dsh-client-store 在 asar 里不存在（纯类型依赖），订阅只能自己写；
      // subscribe 必须返回 unsubscribe 且引用稳定，否则 useSyncExternalStore 每帧重订阅
      const subscribe = React.useCallback((cb) => {
        s.listeners.add(cb)
        return () => { s.listeners.delete(cb) }
      }, [sessionId])
      const getSnapshot = React.useCallback(() => s.snapshot, [sessionId])
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      return [snapshot, actions]
    }

    /**
     * 替换草稿前先做 CAS 检查。
     * ⚠️ 只调一次 captureInsertion()：它每次都重新取当前 span，调两次之间用户敲一个字，
     *    就会拿旧 rev 配新 span。
     * ⚠️ 整体替换必须用 setDraft，不能用 insertText——后者是**插入**，
     *    captureInsertion() 返回的是光标处的空 span，用它只会把改写稿插在原文前面。
     */
    function applyResult(inputActions, resultText, resultDraftRev, liveDraft) {
      if (inputActions === undefined || inputActions === null) return { ok: false, reason: 'no-input' }
      const span = inputActions.captureInsertion()
      if (resultDraftRev !== null && span?.draftRev !== resultDraftRev) return { ok: false, reason: 'stale' }
      // 原文＝发起那一刻的草稿，由 start() 传进来；不能从 span 里取（见上面那条注释）
      const original = typeof liveDraft === 'string' ? liveDraft : ''
      inputActions.setDraft(resultText)
      inputActions.persistDraft()   // 立刻落盘，避免用户直接关页面丢掉
      return { ok: true, original }
    }

    // ===== 组件 =====
    /**
     * 增强提示词图标：照 workbuddy 参考图——一颗大的四角星 + 右上角一颗小的实心四角星。
     * 四角星用二次贝塞尔从四个尖角向内凹，才有「星芒」的收腰感；直线连四角会变成菱形。
     * currentColor 描边，跟随主题；不用 emoji（跨系统渲染不一致、无法跟随主题色）。
     */
    function SparkIcon() {
      return React.createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, [
        // 主星：中心 (6.9, 9.1)，四尖角到中心 4.5
        React.createElement('path', {
          key: 'a',
          d: 'M6.9 4.6C7.3 7 8.9 8.6 11.4 9.1C8.9 9.6 7.3 11.2 6.9 13.6C6.5 11.2 4.9 9.6 2.4 9.1C4.9 8.6 6.5 7 6.9 4.6Z',
        }),
        // 小星：右上角，实心，与主星同色
        React.createElement('path', {
          key: 'b',
          fill: 'currentColor', stroke: 'none',
          d: 'M12.5 2.2C12.7 3.5 13.5 4.3 14.8 4.5C13.5 4.7 12.7 5.5 12.5 6.8C12.3 5.5 11.5 4.7 10.2 4.5C11.5 4.3 12.3 3.5 12.5 2.2Z',
        }),
      ])
    }
    /** 回退图标：同尺寸的回转箭头，与优化图标形状明显不同，用户一眼能看出「再点一下就撤掉」 */
    function RevertIcon() {
      return React.createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, [
        React.createElement('path', { key: 'a', d: 'M3.6 6.4h5.6a3.1 3.1 0 0 1 0 6.2H7' }),
        React.createElement('path', { key: 'b', d: 'M5.9 4.1 3.4 6.4l2.5 2.3' }),
      ])
    }
    /**
     * 优化按钮：**一个图标承载全部状态**，没有任何浮层。
     *   idle    → 星形图标，点击发起优化
     *   loading → 同位置转圈，点击取消
     *   applied → 回转箭头，点击在优化稿 / 原文之间来回切换
     *   error   → 图标变红 4 秒后自动复原，点击可立刻重试
     */
    function makeButton(t, controller) {
      return function PolishButton(props) {
        const sessionId = props.sessionId
        // 总开关必须**热生效**（关掉后按钮立刻消失，不重启）。
        // 订阅的是与设置卡片同一个 controller 实例（configForms.get 按 entryId 缓存共享）。
        // ⚠️ unavailable / loading 时 value 为 undefined，必须当作「启用」，否则插件没配置好时按钮凭空消失。
        const configSnap = React.useSyncExternalStore(
          (cb) => controller.subscribe(cb),
          () => controller.getSnapshot(),
          () => controller.getSnapshot(),
        )
        const enabled = configSnap.value?.enabled !== false
        const draft = props.useInput((s) => (typeof s?.draft === 'string' ? s.draft : ''))
        const phase = props.useInput((s) => (s?.phase ?? 'plain'))
        const refs = props.useInput((s) => (Array.isArray(s?.occurrences) ? s.occurrences.length : 0))
        // ⚠️ 只数 attachmentIds：InputState 没有 imageIds 字段（input.ts:306-326）
        const attachmentCount = props.useInput((s) => (Array.isArray(s?.attachmentIds) ? s.attachmentIds.length : 0))
        const [state] = usePolishState(sessionId)
        const inputActions = props.inputActions
        // 连点防护用 ref 同步锁：React state 在同一批次里两次点击都读到旧值
        const lockedRef = React.useRef(false)

        // 把 inputActions 登记给模块级 start()/toggle()，否则它们读不到 draftRev。
        // 必须放在 effect 里：render 期写模块级 Map 是副作用，严格模式下会重复执行并告警
        React.useEffect(() => {
          registerInput(sessionId, inputActions)
          return () => { registerInput(sessionId, undefined) }
        }, [sessionId, inputActions])

        const status = state.status
        const busy = status === 'loading' || status === 'streaming'

        // 输入框里此刻装的，是不是我们上一次写进去的那一份（优化稿或原文）。
        // 只有仍然一致时，同一个图标才扮演「回退/恢复」；用户一动手改字，它立刻变回「继续优化」。
        const expected = status === 'applied'
          ? (state.showing === 'original' ? state.original : state.text)
          : null
        const canToggle = expected !== null && draft === expected

        // 守卫链只拦「发起优化」这一个动作；顺序有讲究，先报最根本的原因
        const reason =
          refs > 0 ? t('reasonQuotes') :
          attachmentCount > 0 && draft.trim() === '' ? t('reasonOnlyAttach') :
          draft.trim() === '' ? t('reasonEmpty') :
          draft.length > MAX_DRAFT ? t('reasonTooLong') :
          null

        // 总开关关掉时整个按钮不渲染（不是禁用）：禁用态会让用户以为是草稿问题
        if (!enabled) return null

        // 发送中一律不许动草稿；能来回切换时不受草稿守卫约束
        const blocked = phase !== 'plain' ? true : canToggle ? false : reason !== null

        // 出错态优先显示失败原因：这是唯一不新增浮层的提示出口（边界条件：失败/超时要提示）
        const label = busy ? t('cancelHint')
          : canToggle ? (state.showing === 'original' ? t('restoreHint') : t('revertHint'))
          : status === 'error' && typeof state.error === 'string' && state.error !== '' ? state.error
          : phase !== 'plain' ? t('reasonSending')
          : reason !== null ? reason
          : t('title')

        // 视觉态：转圈 / 回转箭头 / 红 / 星形。改过字就自动退回星形，不靠额外提示
        const visual = busy ? 'loading'
          : canToggle ? 'applied'
          : status === 'error' ? 'error'
          : 'idle'

        // 悬停提示（追加需求，不改动原有逻辑）：鼠标悬停/键盘聚焦时在图标正上方浮出一行字。
        // 常态文案固定为「增强提示词」；取消、回退、出错这三种状态下改成对应动作名，
        // 否则用户悬停在转圈或箭头上看到的还是「增强提示词」，与实际点击行为不符。
        const tip = busy ? t('tipCancel')
          : canToggle ? (state.showing === 'original' ? t('tipRestore') : t('tipRevert'))
          : status === 'error' && typeof state.error === 'string' && state.error !== '' ? state.error
          : blocked ? label
          : t('tipEnhance')

        return React.createElement('button', {
          type: 'button',
          className: 'pp-trigger',
          'data-state': visual,
          // 纯图标：可读名全靠 aria-label，不能省
          'aria-label': label,
          // 不用 disabled：disabled 会被键盘/读屏跳过，用户不知道为什么点不动
          'aria-disabled': blocked ? 'true' : 'false',
          // 气泡与 title 都挂上：气泡是主出口，title 留给读屏与极窄屏兜底
          title: tip,
          onClick: () => {
            // 加载中点击＝取消：同一个入口，不额外占用任何区域
            if (busy) { actions.cancel(sessionId); return }
            if (blocked || lockedRef.current) return
            // 草稿没被动过 → 在优化稿与原文之间来回切换（同步动作，不需要锁）
            if (canToggle) { actions.toggle(sessionId, draft); return }
            // 动过（或从没优化过）→ 一律拿**当前**草稿重新发起，这就是「在此基础上继续优化」
            lockedRef.current = true
            Promise.resolve(actions.start(sessionId, draft)).finally(() => { lockedRef.current = false })
          },
        }, [
          busy
            ? React.createElement('span', { key: 'i', className: 'pp-spinner', 'aria-hidden': 'true' })
            : canToggle
              ? React.createElement(RevertIcon, { key: 'i' })
              : React.createElement(SparkIcon, { key: 'i' }),
          // role=tooltip + aria-hidden=false 让它对读屏可见；样式上纯 CSS :hover 控制显隐，
          // 不做任何 JS 状态，移开即消失，没有延迟也没有残留
          React.createElement('span', { key: 't', className: 'pp-tip', role: 'tooltip' }, tip),
        ])
      }
    }

    // 仅供 tools/selfcheck.cjs 断言内部函数：宿主里 window.__PP_TEST__ 不存在，这段永不执行
    if (typeof window !== 'undefined' && window.__PP_TEST__ === true) {
      window.__PP_TEST_API__ = { NS, PKG, ROUTE, stores, setSnapshot, start, cancel, toggle, applyResult, IDLE }
    }

    // ⚠️ bundle 版槽位不注入 form（PluginManagerPage.tsx:822 只传 { view:'page' }），
    //    必须自己 configForms.get(entryId) 拿 controller（按 entryId 缓存共享，不能自己 dispose）
    /**
     * 设置卡片。三块职责分开写，因为每一块的坑都不一样：
     *   ① 控件本身：数字框必须本地草稿态 + 失焦/回车提交，否则受控 input 会把用户刚删的字符打回旧值；
     *   ② 模型下拉：数据来自宿主远程 session.modelCatalog()，一次拉全量、失败要把原因显示出来；
     *   ③ 写配置：set()/unset() 返回 Promise<boolean> 且会 reject，静默吞掉会让「改了没生效」变成哑巴亏。
     */
    function makeConfigCard(t, controller, loadCatalog) {

      function row(label, hint, control) {
        return React.createElement('div', { className: 'pp-row', key: label }, [
          React.createElement('div', { className: 'pp-row-label', key: 'l' }, [
            React.createElement('span', { key: 't' }, label),
            hint === null ? null : React.createElement('span', { key: 'h', className: 'pp-row-hint' }, hint),
          ]),
          React.createElement('div', { key: 'c' }, control),
        ]);
      }

      /**
       * 数字框：本地草稿态。
       *
       * ⚠️ 之前是纯受控组件（value 直接取快照 + onChange 立刻 set），实测的坏现象是
       *    「删一个字符不生效，按两次退格才删掉一个，之后再也删不动」——
       *    因为 onChange 里 set() 是异步的，快照还没回来，React 就把 DOM 值打回了旧数字；
       *    越界值还会被 onNumber 静默 return，连写都不写，用户完全不知道为什么打不进去。
       *
       * 现在的做法：输入期间只改本地字符串，失焦或回车时才校验并提交；
       * 越界不吞掉，直接把原因显示在输入框下面。
       */
      function NumberField(props) {
        const { value, min, max, step, disabled, label, hint, onCommit, t: tr } = props
        const [draft, setDraft] = React.useState(value === undefined ? '' : String(value))
        const [focused, setFocused] = React.useState(false)
        const [warn, setWarn] = React.useState('')

        // 外部值变了（别的标签页改设置、或提交后快照回流）时同步本地草稿；
        // 正在输入时不覆盖，否则用户打一半会被打断
        React.useEffect(() => {
          if (!focused) setDraft(value === undefined ? '' : String(value))
        }, [value, focused])

        const commit = () => {
          const raw = String(draft).trim()
          if (raw === '') {
            setWarn('')
            onCommit(null)   // 空值 = 回到 schema 默认值
            return
          }
          const num = Number(raw)
          if (!Number.isFinite(num)) { setWarn(tr('settings.notNumber')); return }
          if (num < min || num > max) {
            // 越界不再静默丢弃：把合法区间直接写在提示行里，用户知道该改成多少
            setWarn(tr('settings.outOfRange') + ' ' + min + ' ~ ' + max)
            return
          }
          setWarn('')
          onCommit(num)
        }

        const node = React.createElement('input', {
          type: 'number', className: 'pp-input', min, max, step, disabled,
          value: draft,
          onChange: (ev) => { setDraft(ev.target.value); if (warn !== '') setWarn('') },
          onFocus: () => setFocused(true),
          // 失焦提交是主路径：用户改完数字直接点别处就该生效
          onBlur: () => { setFocused(false); commit() },
          // 回车立即提交，省得还要点一下别处
          onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.currentTarget.blur() } },
        })

        if (warn === '') return row(label, hint, node)
        return row(label, hint, React.createElement('div', { className: 'pp-num-wrap' }, [
          node,
          React.createElement('div', { key: 'w', className: 'pp-cfg-error' }, warn),
        ]))
      }

      /**
       * 模型下拉。
       *
       * 数据来自宿主远程 `session.modelCatalog()`（dsh-api-session-controller 的 @Remote，
       * 注释原文：Describe every currently routable model for Host-generation selectors），
       * 返回 { default, routableProviders, groups[{id,name,models[{id,name}]}], failures }。
       *
       * ⚠️ 不用 ctx.modelDirectories：它的 directoryFor(sessionId) 需要**具体会话**，
       *    而设置页是 root 作用域、没有 sessionId；且该服务在会话未绑定 scope 时直接抛错。
       * ⚠️ 模型目录是低频变化的数据，这里只在挂载时拉一次，不做实时订阅，避免多余的刷新链路。
       */
      function ModelPickers(props) {
        const { provider, model, disabled, onPick, loadCatalog } = props
        const [state, setState] = React.useState({ status: 'loading', groups: [], error: '' })

        React.useEffect(() => {
          let alive = true
          loadCatalog().then((catalog) => {
            if (!alive) return
            setState({ status: 'ready', groups: Array.isArray(catalog?.groups) ? catalog.groups : [], error: '' })
          }).catch((e) => {
            if (!alive) return
            setState({ status: 'error', groups: [], error: String(e?.message ?? e) })
          })
          return () => { alive = false }
        }, [])

        const groups = state.groups
        const providerOptions = groups.map((g) => ({ value: g.id, label: g.name === undefined ? g.id : g.name }))
        const active = groups.find((g) => g.id === provider)
        const modelOptions = active !== undefined && Array.isArray(active.models)
          ? active.models.map((m) => ({ value: m.id, label: m.name === undefined ? m.id : m.name }))
          : []

        /**
         * 一个下拉。
         * ⚠️ 若 current 不在 options 里（模型已下线、配置来自旧版本），原生 select 会显示空白，
         *    用户会以为设置丢了。这里把当前值补成一项并标注「不可用」，让人知道该重选。
         */
        const select = (options, current, onPickValue, placeholderKey) => {
          const known = current === '' || options.some((o) => o.value === current)
          const extra = known ? [] : [{ value: current, label: current + ' (unavailable)' }]
          return React.createElement('select', {
            className: 'pp-input pp-select', disabled,
            value: current === '' ? '' : current,
            onChange: (ev) => onPickValue(ev.target.value),
          }, [
            React.createElement('option', { key: '__empty', value: '' }, t(placeholderKey)),
            ...options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)),
            ...extra.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)),
          ])
        }

        // 目录拉取失败时把原因显示出来：不然用户只看到两个只有一项的下拉，会以为设置页坏了
        const dirError = state.status === 'error'
          ? React.createElement('div', { className: 'pp-cfg-error', key: 'de' }, t('settings.catalogFailed') + state.error)
          : null

        return [
          dirError,
          row(t('settings.fixedProvider'), t('settings.fixedHint'), React.createElement('div', { className: 'pp-select-wrap', key: 'p' }, [
            select(providerOptions, provider, (v) => onPick(v, ''), 'settings.followSession'),
          ])),
          row(t('settings.fixedModel'), null, React.createElement('div', { className: 'pp-select-wrap', key: 'm' }, [
            select(modelOptions, model, (v) => onPick(provider, v), 'settings.followSession'),
          ])),
        ]
      }

      return function ConfigCard() {
        const snap = React.useSyncExternalStore(
          (cb) => controller.subscribe(cb),
          () => controller.getSnapshot(),
          () => controller.getSnapshot(),
        );
        const [err, setErr] = React.useState('');
        const [ok, setOk] = React.useState('');

        // 三态必须分开处理：unavailable 时画空表单会让用户以为「插件没有配置项」
        if (snap.status === 'loading') return React.createElement('div', { className: 'pp-hint' }, t('settings.loading'));
        if (snap.status === 'unavailable') return React.createElement('div', { className: 'pp-hint' }, t('settings.unavailable'));

        const value = snap.value ?? {}
        const disabled = snap.writable === false

        // 统一的写入口：
        //   ⚠️ set()/unset() 返回 Promise<boolean> 且会 reject（Transport failures reject），
        //      用 void 吞掉会让「改了没生效」变成哑巴亏——必须两个分支都接到界面上。
        //   ⚠️ 清空的数字框 Number('') === 0，会把 timeoutSeconds 写成 0 撞上 min(10) 校验，
        //      所以空值一律走 unset 回到 schema 默认值，而不是写 0。
        const write = (field, v) => {
          setErr('');
          setOk('');
          const p = v === null ? controller.unset(field) : controller.set(field, v);
          p.then((accepted) => {
            if (accepted) setOk(t('settings.saved'));
            else setErr(t('settings.refused'));
          }).catch((e) => setErr(String(e?.message ?? e)));
        };

        /** 复选框：schema 是 boolean，没写过时快照给的是默认值，故用 !== false 判 */
        const check = (field, label, hint) => row(label, hint, React.createElement('input', {
          type: 'checkbox', key: field, checked: value[field] !== false, disabled,
          onChange: (ev) => write(field, ev.target.checked),
        }));

        /**
         * 服务商与模型必须**一次原子写**：分两次 set 会各带一次 revision，第二次可能被判冲突而静默失败。
         * 选服务商时顺手清空模型——不同服务商的模型 id 不通用，留着旧值只会变成一个填了但不存在的组合，
         * 宿主解析时会失败，用户却以为设置生效了。
         */
        const pickModel = (providerId, modelId) => {
          setErr('');
          setOk('');
          const ops = [{ op: 'set', path: ['fixedProvider'], value: providerId }];
          if (modelId === '') ops.push({ op: 'unset', path: ['fixedModel'] });
          else ops.push({ op: 'set', path: ['fixedModel'], value: modelId });
          controller.mutate(ops).then((accepted) => {
            if (accepted) setOk(t('settings.saved'));
            else setErr(t('settings.refused'));
          }).catch((e) => setErr(String(e?.message ?? e)));
        };

        const numField = (field, label, hint, min, max, step) => React.createElement(NumberField, {
          key: field, value: value[field], min, max, step, disabled, label, hint,
          onCommit: (v) => write(field, v), t,
        });

        return React.createElement('div', { className: 'pp-config' }, [
          err !== '' ? React.createElement('div', { key: 'e', className: 'pp-cfg-error', role: 'alert' }, err) : null,
          ok !== '' ? React.createElement('div', { key: 'o', className: 'pp-cfg-ok' }, ok) : null,
          check('enabled', t('settings.enabled'), t('settings.enabledHint')),
          // 两个下拉各自一行（ModelPickers 内部渲染成两个 row），标签才与控件对得上
          React.createElement(ModelPickers, {
            key: 'pickers',
            provider: String(value.fixedProvider ?? ''),
            model: String(value.fixedModel ?? ''),
            disabled,
            onPick: pickModel,
            loadCatalog,
          }),
          numField('temperature', t('settings.temperature'), t('settings.temperatureHint'), 0, 1, 0.1),
          numField('timeoutSeconds', t('settings.timeoutSeconds'), t('settings.timeoutHint'), 10, 300, 1),
          numField('maxDraftChars', t('settings.maxDraftChars'), t('settings.maxDraftHint'), 500, 20000, 100),
          numField('maxTokens', t('settings.maxTokens'), t('settings.maxTokensHint'), 0, 32768, 256),
          numField('lengthRatio', t('settings.lengthRatio'), t('settings.lengthRatioHint'), 1, 3, 0.5),
          check('allowPlaceholder', t('settings.allowPlaceholder'), t('settings.allowPlaceholderHint')),
        ]);
      };
    }

    return {
      // 这里的 inject 是 cordis 服务名，不是包名（包名那套在 package.json 的 dsh.client.inject）
      inject: ['slots', 'configForms', 'locale', 'remote', 'remote.session'],
      apply(ctx) {
        // 国际化：注册中英两套字典。⚠️ LocaleRuntime 没有 t 成员，只有 bind(ns)
        // （dsh-client-locale/src/client/index.ts:459-468），写 ctx.locale.t?.() 会静默退化成返回 key 原文
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'prompt-polish: locale')
        const t = ctx.locale.bind(NS)

        // 模块级的 start()/toggle() 拿不到组件作用域的 t，靠这个变量把翻译函数递进去，
        // 否则 flashError 里只能显示 key 原文（translate 默认就是原样返回 key）
        translate = t

        // 样式必须在 factory 同步执行期内插入，晚插的 <style> 卸载时清不掉
        ctx.effect(installStyles, 'prompt-polish: styles')

        // 同一个 controller 实例同时喂给按钮（读 enabled）与设置卡片（读写九键），
        // 这样「关掉总开关 → 按钮立刻消失」是同一份快照驱动的，不会出现两处不同步
        const controller = ctx.configForms.get(NS)

        const PolishButton = makeButton(t, controller)

        /**
         * 拉一次宿主模型目录，供设置页的两个下拉使用。
         *
         * 为什么不在 ModelPickers 里直接调 ctx.remote：组件拿不到 ctx，且失败原因要能在
         * 界面上显示，所以包一层把 Result 归一成「要么返回 catalog，要么抛带原因的错」。
         * ⚠️ 远程调用返回的是 Result（{ ok, value } / { ok, error }），不 ok 时必须自己抛，
         *    否则调用方会把 undefined 当成空目录，用户看到两个空下拉却没有任何解释。
         */
        const loadCatalog = async () => {
          const response = await ctx.remote.session.modelCatalog()
          if (!response.ok) throw new Error(response.error.code + ': ' + response.error.message)
          return response.value
        }

        const ConfigCard = makeConfigCard(t, controller, loadCatalog)

        // ① 按钮：纯图标，挂在模型选择器左侧（input.right 整块渲染在 input.model 之前，天然在左侧）。
        //    交互改造后**只有这一个槽位**：结果直接回显输入框，不再有结果面板或任何浮层。
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'prompt-polish-trigger',
          order: -10,   // 升序排列（scoped-slots.tsx:1481-1499），-10 落在 provider 名（order 0）左侧
          // ★ inject 的第一个位置参数就是 sessionId（scoped-slots.tsx:172-185）；props 里没有
          inject: (sessionId) => ({ sessionId }),
        }, PolishButton))

        // ② 设置：挂插件详情页。key 必须等于包名，否则插件页判定为「未配置」整段不渲染
        //    whileServed 保证插件未启用时不留空壳页面，返回的 disposer 必须包进 ctx.effect
        ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject(
          'plugins.bundle.config',
          () => ctx.slots.register({
            name: 'plugins.bundle.config',
            key: PKG,
            id: 'prompt-polish-config',
          }, ConfigCard),
        )), 'prompt-polish: settings')
      },
    }
  },
});
