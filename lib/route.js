/**
 * 模型路由：四级降级，返回 { provider, model, source } 或 null。
 *
 * 为什么不用一个固定模型：用户改了会话里的模型，优化也应该跟着走；
 * 但设置里又允许钉死一对，所以顺序必须是 请求体 → 设置 → 会话 → 全局默认。
 *
 * 取服务一律用 scope.get(名字) 而不是 scope.名字：scope 是 ctx 的受限视图，
 * 只有 get 是稳定接口；直接点属性在服务未加载时拿到 undefined 而不是抛错，
 * 两者结果一样，但 get 的写法与官方插件一致，读代码的人不会误以为可以少写判空。
 */

function usable(candidate) {
  // provider 与 model 必须同时是「非空字符串」。只填一半不算配置，继续往下降级，
  // 绝不能把 undefined 传进 llm.stream —— 那会变成一次语义不明的默认模型调用。
  if (candidate === null || typeof candidate !== 'object') return null
  const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
  if (provider === '' || model === '') return null
  return { provider, model }
}

export function resolveRoute(scope, sessionId, config, requested) {
  // 零级：请求体显式指定（首版客户端不发，留给将来「单次换模型」用）
  const fromRequest = usable(requested)
  if (fromRequest) return { ...fromRequest, source: 'request' }

  // 一级：设置里钉死的固定对
  const fromSettings = usable({ provider: config?.fixedProvider, model: config?.fixedModel })
  if (fromSettings) return { ...fromSettings, source: 'settings' }

  // 二级：会话当前的模型选择（投影里的 next 是待生效，lastUsed 是上次实际用过）
  if (typeof sessionId === 'string' && sessionId !== '') {
    try {
      const session = scope.get('sessions')?.get?.(sessionId)
      if (session) {
        const snapshot = scope.get('sessionProjections')?.snapshot?.(session, ['modelSelection'])
        const selection = snapshot?.values?.modelSelection
        const fromSession = usable(selection?.next) ?? usable(selection?.lastUsed)
        if (fromSession) return { ...fromSession, source: 'session' }
      }
    } catch {
      // 投影服务在会话刚建立时可能还没就绪；这里静默降级，不要因为读不到选择就整单失败
    }
  }

  // 三级：全局默认模型
  try {
    const fromDefault = usable(scope.get('agentDefaultModel')?.currentSelection?.())
    if (fromDefault) return { ...fromDefault, source: 'default' }
  } catch {
    // 同上：默认模型服务缺失时按「没有可用模型」处理，由上层转 503
  }

  return null
}