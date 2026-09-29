# AGENTS.md — AI 协作须知（Zcode+ 管理控制台）

本文件给任何在此仓库工作的 AI 会话（ZCode / Claude / Codex 等）与新人。人类协作者也可读。

## 项目是什么

Electron 桌面应用（`app/`，产品名 ZCodeSkinLauncher）：管理 ZCode 客户端的换肤主题——
导入图片/DreamSkin 主题包、注入装饰性 CSS、轮换/滤镜/预览、社区主题（DreamSkin.cc 受限只读）。
核心机制：CDP（9222 调试端口）向 ZCode 页面注入 `#zskin-layer` + `<style>`，**不修改 ZCode 任何文件**。

## 三条红线（任何改动前先过）

1. **不修改 ZCode 的文件**（不 patch app.asar、不改它的配置）——"不改应用文件、一键可恢复"是核心卖点。
2. **不读取、不上传聊天数据**——CDP 只用于注入装饰性 CSS 与主题偏好键，禁止读会话内容。
3. **非官方第三方定位**——UI 与文档明示，不伪装官方，不拦截 ZCode 业务行为。

新增任何 CDP 调用或网络访问，必须同步 README 安全声明。

## 常用命令（在 `app/` 下）

| 命令 | 作用 |
|---|---|
| `npm start` | 开发运行（electron .） |
| `npm test` | 单元测试（node:test，46+ 用例，<1s；CI 同款） |
| `npm run deploy` | **改了根文件后必跑**（见下） |
| `npm run dist` | 打包到 dist-new/（离线，需 electron 缓存 zip） |

## 必须知道的坑（踩过的，别再踩）

1. **硬链接部署陷阱**：`main.js`/`preload.js`/`package.json`/`gpu-off.flag` 以硬链接挂进
   dist-new；Edit/Write 是原子替换（新 inode）会**静默断链**，部署目录停留旧代码
   （v2.1.0 滤镜滑块"修了还坏"的真因）。→ 改任何根文件后跑 `npm run deploy`；
   `test/deploy-check.test.js` 会把断链变成红灯。`src/`、`ui/` 是 junction，改动自动生效。
2. **`config.json.bak` 不是坏文件**：`require("xxx.json.bak")` 按 JS 解析报
   `Unexpected token ':'`；读它用 fs.readFileSync + JSON.parse。
3. **CDP evaluate 共享页面全局**：脚本一律包 IIFE，否则第二次声明 `const` 静默失败（ADR-004）。
4. **ZCode 启动**：Mimosa 钩子禁 `spawn(变量exe,...)`，用固定 PowerShell Start-Process +
   环境变量传路径（ADR-001）；拿不到 pid，探活走 tasklist 缓存。
5. **asar 版本解析**：JSON 边界按偏移 [12-15] 的字符串长度前缀截断（[8-11] 含对齐填充）。
6. **Windows/Git Bash**：`tasklist /fi` 参数会被 MSYS 路径转换破坏；`cmd //c` 的 `\$var`
   不展开。npm audit 本机要加 `--registry=https://registry.npmjs.org`（npmmirror 无 audit 端点）。
7. **Mimosa 安全钩子**（本机 PreToolUse）：`path.join(root, 动态名)` 即使是白名单常量也可能被
   判路径穿越——按建议包 `resolveWithin(root, name)`（resolve + 边界断言）；含 `spawn(exe,...)`
   的旧代码无法用 Edit 删除，只能整文件重写。
8. **测试基建**：`test/helpers/electron-mock.js` 用 require.cache 注入 fake electron
   （必须在 require 任何 src/ 模块前调用）；node --test 用无参数默认发现（目录参数在
   Windows 会误当入口模块）。

## 单实例锁与冒烟测试

生产实例占着单实例锁时做冒烟：复制 app 结构到同卷目录（文件硬链接 + 目录 junction +
改名 `-test` 的 package.json → userData 隔离到 `%APPDATA%\zcode-skin-launcher-test`），
用 `node_modules\electron\dist\electron.exe . --remote-debugging-port=9555` 起 CDP 验证。

## 文档地图

| 文档 | 定位 |
|---|---|
| `README.md` | 用户视角：功能/用法/安全声明 |
| `app/CHANGELOG.md` | 版本事实（每个功能 PR 必带条目） |
| `FEATURE_PROPOSALS.md` | 提案池（标注已实施/已否决） |
| `OPTIMIZATION_PLAN*.md` | 历史计划（完成后归档只读） |
| `docs/adr/` | 架构决策记录（改这些决策前先读） |
| `docs/security-audit-*.md` | 安全扫描与依赖审计记录 |

## 安全声明（简版，全文见 README）

不修改 ZCode 文件；不读不上传聊天数据；联网仅限"检查更新"与社区主题下载（用户主动触发、
只读 GET、固定 API 白名单、SHA-256 校验）；所有数据留在本机 `%APPDATA%\zcode-skin-launcher\`。
