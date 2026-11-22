# 安装（从源码）

> 本仓库是 `dsh-prompt-polish` 的源码镜像，**不含** `node_modules` 副本。原因见 README「依赖说明（重要）」一节：
> 插件依赖宿主自带的 `@deepseek-ai/schemastery` 与 `@deepseek-ai/cosmokit`，DSH 安装目录里已有这两份，复制比重新安装更可靠。

## 1. 复制依赖

从本机 DSH 安装目录的 `node_modules/@deepseek-ai/` 下，把 `schemastery`（3.19.0）与 `cosmokit`（1.9.0）
复制到插件根目录的 `node_modules/@deepseek-ai/`。两个包都是纯 JS，无原生编译步骤。

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
