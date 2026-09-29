# ADR-002：junction + 硬链接部署模型（npm run deploy）

- 状态：已接受（2026-09-26 起）
- 关联：`app/deploy.mjs`、`OPTIMIZATION_PLAN_V2.md` §3.4

## 背景

日常开发用 `npx electron .`（源码目录），但分发用的是 `dist-new/ZCodeSkinLauncher-win32-x64/`
的打包产物。若每次改动都重打包（269MB、分钟级），迭代不可承受；若只改部署目录，两边会漂移。

## 决策

- `src/` 与 `ui/` 以**目录 junction** 挂进部署目录——改动自动生效，无需处理。
- `main.js` / `preload.js` / `package.json` / `gpu-off.flag` 以**硬链接**挂入。
- 关键约束：**Edit/Write 对文件是原子替换（新 inode），会静默断开硬链接**，部署目录停留在
  旧代码。改任何根文件后必须跑 `npm run deploy`（deploy.mjs 用 fs.linkSync 重建链接）；
  重打包前同样先跑 deploy 或直接 `npm run dist`。

## 后果

- 正面：日常迭代秒级生效、打包产物与源码强一致。
- 负面（已发生）：v2.1.0 滤镜滑块"修了还坏"的真因就是 preload 断链。
- 缓解：`test/deploy-check.test.js` 逐字节比对部署目录与源码，断链即红灯并提示修复；
  无 dist-new 的环境（CI）自动跳过。
