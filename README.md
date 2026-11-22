# dsh-prompt-polish

在输入框「Magpie」左侧加一个**纯图标**按钮：点一下，把当前草稿交给模型重写成更清晰的提示词，
**结果直接回显到输入框**（替换当前草稿），**不自动发送**。

## 一个图标，三种动作（无任何弹框/浮层）

鼠标悬停在图标上会浮出一行提示（深灰气泡，跟随浅深主题）。常态文案是「增强提示词」；
转圈、回退、出错三种状态下自动换成对应动作名，避免「悬停转圈却写着增强提示词」。
显隐纯 CSS `:hover`，移开即消失，无延迟无残留。

| 图标状态 | 点击做什么 |
| --- | --- |
| 星形（常态） | 发起优化。生成期间**在图标原位转圈**，此时再点＝取消 |
| 回转箭头（优化稿已在输入框） | 回退到优化前的原文 |
| 回转箭头（原文已在输入框） | 恢复刚才的优化结果 |
| 红色（失败/超时） | 8 秒后自动复原；点一下立刻重试。原因显示在鼠标悬停提示里 |

**在优化稿与原文之间可以反复来回切**。一旦你手动改了输入框里的字，图标立刻变回星形——
此时再点是**基于新内容继续优化**，而不是拿旧原文把你刚打的字盖掉。

**失败或超时**：输入框保持原样（不会变成空、也不会变成半截结果），图标变红并在悬停提示里给出原因。

## 它做什么 / 不做什么

- 做：补全角色、上下文、步骤、输出格式、验收标准、边界条件；保留你的原意与专有名词。
- 做：结果直接写进输入框，走 `setDraft` + `persistDraft`，并做 `draftRev` CAS 检查——
  你在等待期间改过草稿，就**一个字符都不会被覆盖**，图标只变红提示一次。
- 做：回退/恢复同样做一次实时草稿比对，草稿被改过就拒绝执行，绝不冲掉你刚打的字。
- 不做：不自动发送、不改你的范围、不编造事实（缺信息写成「（待补充：…）」，可在设置里关掉）。

## 设置

插件页 → `dsh-prompt-polish` → 配置。九个键全部 `.volatile()`，**改完立刻生效，不用重启**。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。关掉后按钮**立刻消失**（不是变灰）。 |
| `fixedProvider` + `fixedModel` | 空 | 两项都填才生效；留空则跟随当前会话所选模型。 |
| `temperature` | `0.2` | 越低越贴近原文。 |
| `timeoutSeconds` | `60` | 超时中止，同时停掉上游计费。 |
| `maxDraftChars` | `8000` | 超过直接拒绝（413），不烧 token。 |
| `maxTokens` | `0` | 0 = 按草稿长度估算，上限取模型 `defaultMaxTokens`。 |
| `lengthRatio` | `2` | 目标长度上限倍数（1~3）。 |
| `allowPlaceholder` | `true` | 允许「（待补充：…）」占位符。 |

## 模型怎么选（四级）

1. 请求体里的 `modelSelection`（首版预留，客户端暂不传）
2. 设置里的 `fixedProvider` + `fixedModel`
3. 当前会话的 `modelSelection` 投影（`next ?? lastUsed`）
4. `agentDefaultModel.currentSelection()`

四级全空返回 503，图标变红并在悬停提示里显示「没有可用的模型，请先在设置里固定一个模型」。

## 接口

`POST /api/prompt-polish/polish`，走 `ctx.connection.fetch.register`（宿主自动做 Host/Origin 与 owner principal 校验）。

请求：`{ draft, sessionId?, context?, modelSelection? }`

响应：`text/event-stream`，每帧 `data: {...}`，四种事件：

- `{ type: "start", provider, model, source }` —— 立刻发，防零字节被代理掐断
- `{ type: "delta", text }`
- `{ type: "done", text, usage }` —— `text` 已过剥洗管线（去围栏/去开场白/去零宽字符）
- `{ type: "error", message }`
- `{ type: "ping" }` —— 每 15 秒一次心跳

状态码：`400` 入参非法 · `403` 总开关关闭 · `409` 同会话正在优化 · `413` 草稿超长 · `415` 非 JSON ·
`429` 全进程并发 > 2 · `503` 无可用模型。

## 离线自检

```
node tools/selfcheck.cjs
```

不启动宿主、不联网，147 项断言覆盖设计文档 7.1 的全部 32 项（含两条硬门槛：
volatile 解包、剥洗管线不误伤）。全部通过时退出码 0。

## 依赖说明（重要）

本插件 `lib/index.js` 第一行就 `import z from '@deepseek-ai/schemastery'`。插件以 junction / 软链链进
`~/.dsh/profiles/<name>/node_modules/` 后，**Node 按真实路径解析**，会从插件目录往上找 node_modules，
找不到 profile 里的那份。

因此**本仓库自带** `node_modules/@deepseek-ai/{schemastery,cosmokit}`（3.19.0 / 1.9.0，MIT，纯 JS），
克隆下来无需联网安装即可运行。不要改成指向宿主 `app.asar` 的 junction——实测 Windows 下指向 asar
内部子目录的 junction 创建成功但**立即失效**；也不要 `npm install`（根 `package.json` 没声明依赖，装了也是空）。

`cosmokit` 的 volatile 用 `Symbol.for("cosmokit.volatile.write")` 全局注册符号，所以插件与宿主各持一份副本
也能互相识别（`isVolatile` 跨副本有效），复制方案是安全的。

## 卸载

从 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 与 `dependencies` 里删掉两行，
再删 `~/.dsh/profiles/desktop/node_modules/dsh-prompt-polish` 这个 junction，重启宿主。
