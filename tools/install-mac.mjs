#!/usr/bin/env node
// Mac（以及任何类 Unix）侧安装脚本：把一个已就位到磁盘的插件目录挂进 DSH profile。
// 为什么不用 pnpm install：profile 加载只看 node_modules/<包名> 目录是否存在，不校验 lockfile，
// 直接建软链最省事，也不会把插件目录里的 node_modules 副本再复制一遍。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// 脚本放在 <插件>/tools/ 下，所以插件根目录是上一级
const PLUGIN_DIR_DEFAULT = path.resolve(HERE, '..')

// 从插件自己的 package.json 读包名，避免脚本里写死名字后与清单不一致
function readPkgName(dir) {
  const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
  const pkg = JSON.parse(raw)
  if (typeof pkg.name !== 'string' || pkg.name === '') throw new Error('插件 package.json 缺少 name 字段')
  return pkg.name
}

function parseArgs(argv) {
  const out = { profile: '', plugin: PLUGIN_DIR_DEFAULT, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') { out.dryRun = true; continue }
    if (a === '--profile') { out.profile = argv[i + 1] ?? ''; i += 1; continue }
    if (a === '--plugin') { out.plugin = path.resolve(argv[i + 1] ?? ''); i += 1; continue }
    if (a === '--help' || a === '-h') { out.help = true; continue }
    throw new Error('无法识别的参数：' + a)
  }
  return out
}

// DSH_HOME 未设置时退回 ~/.dsh；profile 名在 Mac 的 CLI 形态下是 web
function defaultProfile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', 'web')
}

// 软链目标比对要按真实路径，否则大小写/相对路径差异会让幂等判断失效
function linkState(linkPath, realTarget) {
  try {
    const stat = fs.lstatSync(linkPath)
    if (!stat.isSymbolicLink()) return 'occupied'
    const cur = fs.readlinkSync(linkPath)
    const curAbs = path.resolve(path.dirname(linkPath), cur)
    return fs.realpathSync(curAbs) === fs.realpathSync(realTarget) ? 'ok' : 'other'
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'absent'
    throw err
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法：node tools/install-mac.mjs [--profile <profile 目录>] [--plugin <插件目录>] [--dry-run]')
    console.log('默认 profile：$DSH_HOME/profiles/web（未设 DSH_HOME 时为 ~/.dsh/profiles/web）')
    return 0
  }
  const profileDir = args.profile === '' ? defaultProfile() : path.resolve(args.profile)
  const pluginDir = args.plugin
  if (!fs.existsSync(path.join(profileDir, 'package.json'))) {
    console.error('找不到 profile 清单：' + path.join(profileDir, 'package.json'))
    console.error('请用 --profile 指定实际 profile 目录（Mac 的 CLI 形态通常是 ~/.dsh/profiles/web）')
    return 2
  }
  if (!fs.existsSync(path.join(pluginDir, 'package.json'))) {
    console.error('找不到插件清单：' + path.join(pluginDir, 'package.json'))
    return 2
  }
  const pkgName = readPkgName(pluginDir)
  const manifestPath = path.join(profileDir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  // 1) 把包名塞进 dsh.profile.bundles —— 这一项决定宿主启动时会不会加载插件
  if (manifest.dsh === undefined || manifest.dsh === null) manifest.dsh = {}
  if (manifest.dsh.profile === undefined || manifest.dsh.profile === null) manifest.dsh.profile = {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  const bundlesChanged = !bundles.includes(pkgName)
  if (bundlesChanged) bundles.push(pkgName)
  manifest.dsh.profile.bundles = bundles

  // 2) 依赖写成 link:，这样即使有人重跑 pnpm install 也不会把插件目录复制成快照
  if (manifest.dependencies === undefined || manifest.dependencies === null) manifest.dependencies = {}
  const wantSpec = 'link:' + pluginDir.split(path.sep).join('/')
  const depChanged = manifest.dependencies[pkgName] !== wantSpec
  if (depChanged) manifest.dependencies[pkgName] = wantSpec

  // 3) 建软链。先判占用情况：已有真实目录就只报错不删，绝不碰别人的东西
  const linkPath = path.join(profileDir, 'node_modules', pkgName)
  const state = linkState(linkPath, pluginDir)

  console.log('插件包名：' + pkgName)
  console.log('插件目录：' + pluginDir)
  console.log('profile：' + profileDir)
  console.log('bundles：' + (bundlesChanged ? '将追加' : '已存在，无需改动'))
  console.log('dependency：' + (depChanged ? '将写为 ' + wantSpec : '已一致'))
  const stateText = { ok: '已就位', absent: '将新建', other: '指向别处，将替换', occupied: '被真实目录占用' }
  console.log('软链：' + stateText[state])

  if (state === 'occupied') {
    console.error('拒绝继续：' + linkPath + ' 是真实目录，不是软链。请先自行确认它是什么再手工处理。')
    return 3
  }

  if (args.dryRun) {
    console.log('--dry-run：未写入任何文件')
    return 0
  }

  // 顺序刻意是「先建链、后写清单」：链建不成时 profile 一个字都不改，
  // 否则会留下「清单声明了、磁盘上却没有」的残局，排查起来比失败本身更贵。
  if (state !== 'ok') {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    if (state === 'other') fs.unlinkSync(linkPath)
    try {
      fs.symlinkSync(pluginDir, linkPath, 'dir')
      console.log('软链已创建：' + linkPath)
    } catch (err) {
      // 权限不足时把等价命令打出来，让用户一条命令补上，而不是卡在这里
      console.error('创建软链失败：' + (err && err.message ? err.message : String(err)))
      console.error('请手工执行：ln -s ' + JSON.stringify(pluginDir) + ' ' + JSON.stringify(linkPath))
      console.error('profile 清单未做任何改动')
      return 4
    }
  } else {
    console.log('软链已就位')
  }

  if (bundlesChanged || depChanged) {
    // 写盘前留一份可回滚的备份，文件名带时间戳防覆盖
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const bak = manifestPath + '.bak-' + stamp
    fs.copyFileSync(manifestPath, bak)
    console.log('已备份清单：' + bak)
    // 先写临时文件再改名，避免中途失败留下半截 JSON
    const tmp = manifestPath + '.tmp-' + stamp
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n')
    fs.renameSync(tmp, manifestPath)
    console.log('清单已更新')
  } else {
    console.log('清单无需改动')
  }

  // 收尾自证：从 profile 出发能不能解析到这个包
  try {
    const resolved = fs.realpathSync(path.join(linkPath, 'package.json'))
    console.log('校验通过：' + resolved)
  } catch (err) {
    console.error('校验失败：从 profile 解析不到插件清单')
    return 5
  }
  console.log('完成。重启 DSH 后生效（插件只在宿主启动时读一次）')
  return 0
}

process.exitCode = main()