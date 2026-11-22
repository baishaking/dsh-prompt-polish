# 安装（从源码）

> 本仓库是 `dsh-prompt-polish` 的源码镜像，**已附带**依赖副本：`node_modules/@deepseek-ai/{schemastery,cosmokit}`
> （3.19.0 / 1.9.0，MIT，纯 JS，无原生编译）。克隆下来即可直接挂载，不需要联网、不需要 `npm install`。

## 1. 依赖（无需操作）

- 两个包已随仓库入库，Node 从插件根目录向上解析就能命中 `node_modules/@deepseek-ai/`。
- `schemastery` 的 `package.json` 在 `dependencies` 里列了 `@standard-schema/spec`，但它的 `lib/` 代码并不 import
  这个包（只用于类型定义），运行时**不需要**，所以仓库没有附它。
- **别删这两个目录**，也别用 `npm install` 去"补"：根 `package.json` 没有声明任何依赖，npm 装不到它们；
  一旦删掉就只剩联网重装一条路（`npm i @deepseek-ai/schemastery@3.19.0 @deepseek-ai/cosmokit@1.9.0`）。

## 2. 挂进 DSH profile

**macOS / Linux**（profile 名通常是 `web`）：

```
node tools/install-mac.mjs --profile ~/.dsh/profiles/web
```

脚本会建软链、把包名写进 `dsh.profile.bundles`，并把依赖记成 `link:`（避免 pnpm install 把插件复制成快照）。

**Windows**（profile 名通常是 `desktop`）：在 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\` 下建
名为 `dsh-prompt-polish` 的 junction 指向插件目录，并在该 profile 的 `package.json` 里写
`"dsh-prompt-polish": "link:<插件绝对路径>"` 与 `dsh.profile.bundles` 条目。
注意：junction **不能**指向 `app.asar` 内部子目录（实测会立即失效）。

## 3. 生效方式

- 改 `lib/index.js`（服务端）→ **重启宿主**；
- 改 `lib/client.js`（客户端）→ 浏览器刷新即可。

## 4. 自检

```
node tools/selfcheck.cjs
```

不启动宿主、不联网，162 项断言全部通过时退出码为 0。
