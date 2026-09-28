# Zcode+ Changelog

## 2.1.0 (2026-09-26)

按 FEATURE_PROPOSALS.md 推荐组合实施（D1/C1/A4/D2/A1+A2/C3/C2）。

### 新功能
- **D1 连接自测向导**：皮肤管理页「连接诊断」按钮，按链路顺序检查 exe 路径 → ZCode 进程 → 调试端口 → 页面目标 → 皮肤注入 → 关键选择器命中，逐步骤输出 ✓/✗ 与修复建议
- **D2 选择器失效检测**：诊断时检查 `#root` / `#content section` / `#sidebar` / `.bg-input` / `.bg-surface` 命中数并落盘快照（含 ZCode 版本）；ZCode 升级（版本变化）或核心选择器归零时，状态栏主动出现 ⚠ 告警。**上线即抓到真实兼容性问题**：ZCode v3.14.x 的 `#content > section` 已变为非直接子元素（包了一层 div），换肤主区选择器随之改为后代匹配 `#content section`
- **C1 开机自启 + 自动应用**：开机自启（登录后驻留托盘，`--hidden`）；「启动后自动应用上次主题」在启动 3 秒后静默执行（仅在由本启动器拉起 ZCode 的前提下生效，不抢端口）
- **A4 卡片实时预览**：皮肤已启用时点主题卡立即热切换预览（不落盘 appliedId），「应用主题」才保存；调参（透明度/位置/滤镜/遮罩）即时重新注入（300ms 防抖）
- **A1 背景滤镜**：每主题独立 模糊(0-20px，自动 scale 抵消边缘羽化) / 亮度 / 对比度 / 饱和度
- **A2 可读性遮罩**：关/轻/重三档（上下渐变 + 暗角），浅色图上保证文字可读
- **C3 全局快捷键**：`Alt+Shift+S` 切换皮肤、`Alt+Shift+N` 下一个主题（默认开启，界面可关）
- **C2 托盘主题菜单**：托盘右键「切换主题」子菜单（最多 15 个，✓ 标记当前），主题增删/改名/切换后自动刷新

### 修复
- 换肤主区选择器 `#content > section` 在 ZCode v3.14.x 失效 → 改为 `#content section`（兼容新旧结构）
- **滤镜滑块失效**（2.1.0 首发缺陷）：preload 把 `{blur:8}` 展开到 payload 顶层而主进程读 `payload.filter.blur`，键名错位导致四个滤镜滑块拖动后参数不落盘、UI 弹回原值；主进程改为同时兼容扁平与嵌套两种 payload 形态
- 渲染层 `draftTheme()` 对启动窗口期（state 尚未从主进程取回）增加空值防御，避免极早的操作触发异常

## 2.0.0 (2026-09-26)

按 OPTIMIZATION_PLAN.md 完成的全量优化（稳定性 → 性能 → 容错 → 结构 → 工程化）。

### 致命/阻断修复
- 补齐 `cmpVersion` 实现：版本管理页「检查更新」不再 100% 崩溃（此前函数未定义）
- 修复 `opBusy` 泄漏：启用/恢复/轮换统一走 withBusy 互斥包装器，任何失败路径都复位；
  另加 60 秒卡死自动解除兜底
- `pickTarget` 补 timeout 事件监听，端口无响应时不再永久挂起
- 每个 CDP 请求 5 秒超时；看门狗加 inflight 标志，杜绝未决请求并发堆积

### 性能
- 启动链路重排：窗口先显示，主题包回填/缩略图/accent 回填挪到 setImmediate 异步执行；
  回填短路条件（packVersion）修复 + zip 解析结果缓存 + 3 秒软超时
- GPU 改为开关式：默认开启硬件加速，app 目录放 `gpu-off.flag` 则软件渲染（本机默认放置，
  因历史黑屏记录）；软件渲染下 UI 自动降级 blur 为纯色背景
- 主题网格缩略图化：导入时生成 360px JPEG 缩略图（backgrounds/thumbs/），渲染加 lazy/async；
  网格改增量更新（按 id 复用卡片节点）
- accent 取色结果导入时落盘缓存，运行期不再反复解码大图
- 状态探测治理：皮肤未启用时只做 HTTP 层探测（不再每 4 秒建 WebSocket）；
  隐藏窗口时渲染层轮询暂停；断线重连指数退避（2s→60s 封顶）
- 去 tasklist 化：优先 HTTP 端口探测；进程判断带 3 秒超时 + 10 秒结果缓存，
  并弃用被 MSYS 路径转换破坏的 /fi 参数
- buildSkinCss 结果缓存（含 dsCss/dsColors 指纹），看门狗重注入直接命中

### 容错
- `transformDsCss` 重写：@media/@supports 递归处理、@keyframes 原样保留、
  含 url(...) 声明整段保护（data URI 分号不再截断声明），结果做大括号配平校验，
  失败自动回退通用皮肤并记录日志
- 配置原子写（tmp + rename），上一次成功内容滚动留 .bak，加载失败自动恢复
- 统一诊断日志 userData/diag.log（512KB 自动截断），全部静默 catch 改为记录；设置页新增「打开日志目录」
- ZCode 启动失败（error 事件）有日志可查；退出时清理轮换定时器与皮肤会话

### 结构
- 单文件 main.js（1116 行）拆分为 main.js + src/ 模块
  （config/cdp/skin/theme-pack/zcode/rotation/state/log + ipc/{themes,runtime,version}）
- UI 拆分：ui/index.html（结构）+ styles.css（样式）+ renderer.js（逻辑）；
  CSP 收紧（script 不再内联）
- UI 逻辑修复：草稿参数分段按钮选择器收窄；事件绑定按功能分组；
  appliedId 变化只移动「使用中」徽章

### 工程化
- 版本号 2.0.0（侧栏/关于页显示真实版本）；产物目录统一 dist-new（与文档一致）
- 清理残留文件（app/nul、_check.mjs、_win.ps1、build-retry.mjs、test-persist.mjs）；新增 .gitignore
- ZCode 进程启动改为 PowerShell Start-Process（路径经环境变量传递，无命令行拼接面）
