# ADR-003：GPU 开关式禁用（gpu-off.flag）

- 状态：已接受（2026-09-26 起）
- 关联：`app/main.js` 顶部、`.gitignore`

## 背景

本机有历史黑屏记录；但全局禁用硬件加速（v1.x 的做法）会让 `backdrop-filter: blur`
退化为软件合成，界面卡顿（旧 OPTIMIZATION_PLAN P2-2）。

## 决策

默认开启硬件加速；`app` 目录存在 `gpu-off.flag`（或启动参数 `--disable-gpu`）时调用
`app.disableHardwareAcceleration()`。该判断必须在 `app ready` 之前，因此不能走异步
config——用文件标志而非配置项。软件渲染时 renderer 检测 `state.gpuOff` 给 body 加
`.no-blur`，blur 降级为不透明纯色背景。

## 后果

- 正面：好机器吃满合成器；黑屏机器放一个空文件即兜底，视觉损失接近零。
- 负面：flag 是机器差异文件，不入库（已在 .gitignore）；打包产物是否含 flag 因机器而异，
  deploy-check 对该文件做"两侧同时存在才比对"的宽容处理。
