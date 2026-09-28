# Zcode+ 管理控制台 · 优化实施计划书

> 基于 2026-09-26 全量代码体检输出。目标：**稳定性与容错** 优先，其次是 **代码结构与可维护性**，
> 附带解决已上报的 **启动慢 / 界面卡顿**。本计划书只做规划，不含实际代码改动。

---

## 0. 结论先行

| 项 | 内容 |
|---|---|
| 代码规模 | `main.js` 1116 行（单文件）、`index.html` 808 行（HTML/CSS/JS 混写）、`preload.js` 20 行、`build.mjs` 44 行 |
| 实测环境 | 本机主题库 8 个主题 / 图片共 17.2MB（最大单张 7.2MB）/ 6 个带 `dsCss`；Downloads 下 zip 数为 0 |
| 问题总数 | 20 项：致命 2、阻断性 2、性能 8、容错 6、UI 逻辑 4、工程化 6（有交叉） |
| 必做且最急 | ① `cmpVersion` 未定义（更新检查 100% 崩）② `opBusy` 泄漏（一次失败永久锁死） |
| 卡顿主因 | 禁用硬件加速 + `backdrop-filter: blur` 软件合成；启动期同步跑主题包回填；4 秒周期轮询里 spawn 进程 + 反复建 WebSocket |
| 执行策略 | 三阶段递进，每阶段独立可验收、可回滚；阶段之间不互相阻塞 |

---

## 1. 现状问题总表

| 编号 | 级别 | 位置 | 问题摘要 |
|---|---|---|---|
| P0-1 | 致命 | `main.js:917 / 961 / 963` | 调用 `cmpVersion()`，全项目无定义、无 semver 依赖 → 检查更新必崩 |
| P0-2 | 致命 | `main.js:999-1017` | `opBusy=true` 后、try/finally 前的 4 处 return 不复位 → 永久锁死 busy |
| P1-1 | 阻断 | `main.js:307-320` | `pickTarget()` 设了 timeout 但没监听 `timeout` 事件 → Promise 永不 settle |
| P1-2 | 阻断 | `main.js:342-364` | `cdpSend` 无超时，配合 async `setInterval` 会并发堆积未决请求 |
| P2-1 | 性能 | `main.js:1104 / 178` | `backfillPackThemes()` 同步跑在 `createWindow()` 前；短路条件 `packVersion` 从未赋值 |
| P2-2 | 性能 | `main.js:13` + `index.html:89` | 全局禁用硬件加速，卡片却用 `backdrop-filter: blur(12px)` |
| P2-3 | 性能 | `index.html:495-539` | `render()` 全量重建网格，`<img>` 直连原图（17.2MB） |
| P2-4 | 性能 | `main.js:108 / 151` | `extractAccent` 每次解码原图，无缓存；看门狗重注入时重复解码 |
| P2-5 | 性能 | `main.js:707-731` | 皮肤未启用时每 4 秒新建一条 WebSocket 再关闭 |
| P2-6 | 性能 | `main.js:568-587 / 591-605` | 断线重连固定 2 秒、无退避无上限；看门狗 4 秒全量 evaluate |
| P2-7 | 性能 | `main.js:295-304` | `zcodeRunning()` 每次轮询 spawn 一个 `tasklist` 进程 |
| P2-8 | 性能 | `main.js:425` | `buildSkinCss` 每次重算整段 CSS（含正则全量替换），无缓存 |
| P3-1 | 容错 | `main.js:385-392` | `transformDsCss` 正则误伤 `@media (...)` 与 `url(data:;base64,...)` |
| P3-2 | 容错 | `main.js:88` | `saveConfig()` 非原子写，写一半崩溃即损坏配置 |
| P3-3 | 容错 | 多处 `catch {}`（603/613/643/1104） | 错误全静默，皮肤掉了无法诊断 |
| P3-4 | 容错 | `main.js:1015 / 1115` | `spawn` 未监听 error；`before-quit` 未清理会话与定时器 |
| P3-5 | 容错 | `main.js:698` | `rotateOnce` 未纳入 `opBusy` 互斥，与手动应用主题可能互踩 |
| P3-6 | 容错 | `main.js:295` | tasklist 参数受 MSYS 路径转换破坏（现场证据：`app/nul`） |
| P4-1 | UI | `index.html:568` | `renderDraftParams()` 用全局 `.seg button` 选择，会清掉深浅色/轮换顺序高亮 |
| P4-2 | UI | `index.html:744` | 全局绑定 onclick，靠后续覆盖才正确 → 依赖顺序的脆弱写法 |
| P4-3 | UI | `index.html:673` | 轮询定时器从不清理，窗口隐藏到托盘后仍在跑 |
| P4-4 | UI | `index.html:668` | appliedId 一变就整屏 `render()` |
| P5-1 | 结构 | `main.js` 1116 行 / `setupIpc` 320 行 | 单文件巨石，职责混杂 |
| P5-2 | 结构 | 全局可变状态散落 | `skinSession` / `opBusy` / `rotateTimer` / `trayApply` / 裸 `config` |
| P5-3 | 工程 | `build.mjs:28` vs README | 产物输出 `dist-new`（269MB 未清理），文档指向 `dist`（空壳） |
| P5-4 | 工程 | `app/nul`、`_check.mjs`、`_win.ps1`、`build-retry.mjs` | 临时/废弃文件残留；无 `.gitignore` |
| P5-5 | 工程 | `package.json` version 恒为 1.0.0 | 侧栏永远显示 v1.0.0，README 承诺的更新检查无实现 |

---

## 2. 阶段一：致命与阻断性修复

**目标**：让应用不再"用着用着废掉"。改动集中在 `main.js`，预计百行以内，风险低。

### 1.1 补 `cmpVersion` 实现（P0-1）

- **根因**：`check-zcode-update` 的三处分支调用了一个从未定义的函数，且 `package.json` 无 semver 依赖。
- **方案**：在 `main.js` 顶层增加纯本地版本比较函数（不引外部依赖，避免打包体积变化）：
  剥离前缀 `v` → 按 `.` 切分 → 逐段 `Number` 比较 → 返回 `-1 / 0 / 1`。
  同时处理非数字段（如 `1.2.3-beta`）时退化为字符串比较，不得抛异常。
- **验收**：在版本管理页点「检查更新」，三种分支（已是最新 / 有新版 / GitHub 兜底）均返回可读文案，不再出现"检查失败"。

### 1.2 修复 `opBusy` 泄漏（P0-2）

- **根因**：`main.js:999` 置位 `opBusy = true` 之后，`try { ... } finally { opBusy = false }` 之前的 4 个早期 `return`
  （未找到 exe / 已记录路径失效 / 端口超时 / ZCode 运行中未开端口）直接跳出，finally 不执行。
- **方案**：把置位之后的全部分支纳入同一个 `try`，早期退出统一改为 `return { ok: false, message }`；
  或者更稳妥地抽出 `withBusy(fn)` 包装器，保证任何退出路径都复位。
- **附带**：`probeStatus()` 增加兜底——若 `opBusy` 持续超过 N 秒（如 60s），自动复位并写日志，作为最后一道保险。
- **验收**：手动触发"未找到 ZCode.exe"（临时改坏路径）→ 修正路径后再次点「启用皮肤」，能正常执行，不再被"上一个操作还在执行中"挡住。

### 1.3 `pickTarget` 补超时监听（P1-1）

- **方案**：`req.on("timeout", () => { req.destroy(); reject(new Error("CDP /json/list 超时")); })`，
  统一给所有 `http.get` 加"timeout 监听 + destroy + reject"三件套（当前只有 `cdpReachable` 做对了）。
- **验收**：手动占用 9222 端口模拟无响应，状态栏不再永久停在"检测中…"。

### 1.4 `cdpSend` 超时与重入保护（P1-2）

- **方案**：给每个 CDP 请求加 5 秒超时（超时即 cleanup + reject）；
  给看门狗的 async interval 加 inflight 标志，上一轮未结束则跳过本轮，杜绝并发堆积。
- **验收**：杀掉 ZCode 后观察 5 分钟，主进程内存与句柄数稳定，无未决请求增长。

**阶段一冒烟清单**

| 步骤 | 期望 |
|---|---|
| 冷启动 → 版本管理 → 检查更新 | 返回正常文案，不报"检查失败" |
| 故意设错 ZCode 路径 → 启用皮肤 → 改正 → 再启用 | 第二次能成功，无 busy 残留 |
| 启用 → 恢复 → 再启用 | 三轮循环稳定，无异常弹窗 |
| 杀掉 ZCode 静置 5 分钟 | 控制台不卡死，CPU 不持续飙高 |

---

## 3. 阶段二：性能治理（对应"启动慢 / 界面卡顿"）

**目标**：冷启动到窗口可见明显变快；滚动、切页、主题网格不再掉帧；托盘驻留时接近零开销。

### 2.1 启动链路瘦身（P2-1）

- **调整顺序**：`loadConfig → setupIpc → createWindow → createTray`，把 `backfillPackThemes()` 挪到窗口显示之后
  用 `setImmediate` 异步执行，先让窗口出来。
- **修掉永不短路**：`importThemePack()` 返回值补上 `packVersion`（取 `meta.version || "1"`），
  使 `main.js:178` 的 `if (t.dsCss && t.dsColors && t.packVersion) continue;` 真正生效；
  同时按 zip 的 `size + mtime` 做一层内存缓存，避免同一 zip 被多个主题重复解析。
- **收敛扫描范围**：4 个硬编码目录改为"上次成功导入所在目录优先 + 其余延后"，并给整体加 3 秒软超时。
- **验收**：Downloads 下放 10 个主题包 zip 压测，冷启动到窗口可见的时间与 zip 数无关；任务管理器无长时间单核占用。

### 2.2 渲染性能（P2-2）

- **硬件加速**：默认**不**全局禁用。改为开关式——通过命令行参数或 app 目录下的 `gpu-off.flag` 触发
  `app.commandLine.appendSwitch("disable-gpu")`，保留给黑屏机器兜底（该调用必须在 `app` ready 前，故不能用异步 config）。
- **blur 降级**：`.card` 的 `backdrop-filter: blur(12px)` 在软件渲染下代价极高。
  方案是给 `body` 加 `.no-blur` 类（关闭 GPU 时自动加），降级为不透明度更高的纯色背景，视觉几乎无损。
- **验收**：分别在开/关 GPU 两种模式下滚动主题页与切换页面，无掉帧感；关 GPU 模式下无黑屏。

### 2.3 主题网格缩略图化（P2-3）

- **方案**：导入图片/主题包时，用 `nativeImage.resize({ width: 360 })` + `toJPEG(80)` 生成一份缩略图，
  存到 `backgrounds/thumbs/<id>.jpg`，config 里加 `thumb` 字段（旧主题缺字段时回退原图，向后兼容）。
  渲染时 `<img>` 用缩略图，并加 `loading="lazy" decoding="async"`。
- **增量渲染**：`render()` 改为 diff 更新（按 id 复用已有卡片节点），避免每次清空重建。
- **验收**：8 个主题（含 7.2MB 大图）下切页/删除/重命名流畅；内存占用较当前明显下降。

### 2.4 accent 结果缓存（P2-4）

- **方案**：`extractAccent()` 的结果在导入时（或首次取色时）写入 `theme.accent` 落盘。
  `themeAccent()` 改为"有缓存用缓存，无缓存才解码"，彻底消除看门狗每 4 秒重解码大图。
- **验收**：对无 accent 的主题启用皮肤后静置，磁盘无周期性读取，CPU 平稳。

### 2.5 状态轮询治理（P2-5 / P2-6）

- **隐藏即暂停**：窗口 `hide`/`show` 与托盘联动，`refreshStatus` 在隐藏时停表，恢复显示时立即跑一次。
- **避免重复建连**：`probeStatus` 在端口可达但无会话时，不再每 4 秒新建 WebSocket；
  改为复用一条空闲长连接，或把检测频率降到 15 秒并只做 HTTP 层探测。
- **重连退避**：`watchSession` 的失败重试改为指数退避（2s → 4s → 8s … 上限 60s），
  且先判端口可达再连；端口不可达时直接进入长休眠，避免空转。
- **验收**：托盘驻留 30 分钟（ZCode 未运行），CPU 占用接近 0，无周期性进程创建。

### 2.6 去 `tasklist` 化（P2-7 / P3-6）

- **根因**：`spawn("tasklist", ["/fi", ...])` 每次轮询创建进程；且现场证据 `app/nul` 显示
  参数被 MSYS 转换成 `<Git 安装目录>/Git/fi`，导致判断失真。
- **方案**：优先用 `net` 探测 9222 端口；进程判断改为"记录 `spawn` 返回的 pid → `process.kill(pid, 0)` 探活"，
  失败再回退一次 `tasklist` 并显式加超时。
- **验收**：从 Git Bash 与资源管理器两种方式启动，状态显示一致正确。

### 2.7 CSS 构建缓存（P2-8）

- **方案**：以 `theme.id + alpha + position + light + dsCss 指纹` 为 key 缓存 `buildSkinCss` 结果，
  看门狗重注入时直接命中缓存。
- **验收**：启用皮肤后静置，无周期性字符串构造开销（可用日志计时佐证）。

**阶段二冒烟清单**

| 步骤 | 期望 |
|---|---|
| Downloads 放 10 个 zip 后冷启动 | 窗口快速出现，无长时间卡顿 |
| 皮肤管理页滚动 / 反复切页 | 无掉帧 |
| 启用皮肤后托盘隐藏 30 分钟 | CPU ≈ 0，回来后状态正确 |
| 从 Git Bash 启动 | 运行状态判断正确 |
| 新旧主题混合（部分无 thumb/accent） | 全部正常显示，无空白卡片 |

---

## 4. 阶段三：容错补强、结构重构与工程化

**目标**：出了问题能定位；代码能长期维护；仓库干净可分发。

### 3.1 CSS 转换容错（P3-1）

- **方案**：`transformDsCss` 增加前置剥离——先把 `@media` / `@supports` / `@keyframes` 块与
  含 `url(` 的声明摘出，只对安全声明加 `!important`，处理完再拼回。
  转换结果做一次基本合法性校验（大括号配平），异常则跳过包样式、回退通用皮肤并记录日志。
- **验收**：构造含 `@media (min-width:768px)` 与 base64 背景的 `theme.css` 主题包，导入后样式不崩、通用皮肤仍生效。

### 3.2 配置原子写（P3-2）

- **方案**：`saveConfig()` 改为写 `config.json.tmp` → `fs.renameSync` 原子替换；
  保留 `.bak-<ts>` 备份但限制数量（最多 3 份，超出删最旧）。
- **验收**：连续快速操作（拖动透明度滑块、反复切换主题）不产生损坏配置；模拟写入中断后重启能自动恢复。

### 3.3 统一日志（P3-3）

- **方案**：新增 `log(tag, msg)`，写入 `userData/diag.log`，带时间戳；文件超过 512KB 时截断保留后半。
  把现有裸 `catch {}` 全部改为 `catch (e) { log(...) }`，覆盖：配置加载、CDP 收发、注入/恢复、看门狗、回填、版本检查。
  设置页加一个"打开日志目录"入口（可选）。
- **验收**：复现"皮肤掉了"后能从日志定位到具体哪一步失败。

### 3.4 生命周期与互斥（P3-4 / P3-5）

- `spawn` 监听 `error` 事件并给出可读提示。
- `before-quit` 中执行 `teardownSession()` + 清理所有 interval/timer。
- `rotateOnce` 纳入与 `enable/restore` 同一套互斥（`opBusy` 或新的 `skinBusy`），避免并发覆盖 `scriptId`。

### 3.5 UI 逻辑修正（P4-1 ~ P4-4）

- `renderDraftParams()` 的选择器收窄为 `#draftParams .seg button`。
- 事件绑定按功能分组、各自限定作用域，不再依赖"后绑定覆盖前绑定"。
- `refreshStatus` 定时器改为可停止（隐藏时停、显示时启）。
- appliedId 变化改为只更新"使用中"徽章，不再整屏 `render()`。

### 3.6 模块拆分（P5-1 / P5-2）

目标结构（保持外部行为完全不变，纯重构）：

```
app/
  main.js              仅生命周期：单实例锁 / 窗口 / 托盘 / ready 流程
  src/
    config.js          配置加载、迁移、原子写、校验
    log.js             环形日志
    cdp.js             端口探测 / 目标选择 / WebSocket / 带超时的 send
    skin.js            CSS 构建、注入脚本、持久会话、看门狗
    theme-pack.js      zip 解析、取色、缩略图
    zcode.js           路径查找、asar 版本读取、更新检查
    rotation.js        轮换池与定时器
    ipc/
      themes.js        导入 / 重命名 / 删除 / 草稿 / 参数
      runtime.js       启用 / 恢复 / 状态
      version.js       ZCode 版本相关
  ui/
    index.html         仅结构
    styles.css         仅样式
    renderer.js        仅逻辑（通过 preload 暴露的 API 通信）
  preload.js
  build.mjs
```

状态治理：把 `skinSession` / `opBusy` / `rotateTimer` / `trayApply` 收敛进一个显式 store，
并定义状态机 `idle → connecting → skinned → error`，UI 只消费状态、不猜状态。

### 3.7 工程化清理（P5-3 ~ P5-5）

| 动作 | 说明 |
|---|---|
| 统一产物目录 | 建议 `build.mjs` 输出回 `dist` 并同步 README；或保留 `dist-new` 则改文档。二者必须一致 |
| 清理 `dist-new` | 269MB，确认无需后删除（**删除前先确认当前分发用的 exe 在哪**） |
| 删除残留文件 | `app/nul`、`_check.mjs`、`_win.ps1`、`build-retry.mjs` |
| 新增 `.gitignore` | `node_modules/`、`dist/`、`dist-new/`、`*.log`、`nul` |
| 版本号 | 从 `package.json` 读取并随功能迭代递增；补 `CHANGELOG.md` |
| README 增补 | 更新检查的实际行为、日志目录位置、关闭 GPU 的兜底开关 |

---

## 5. 建议执行顺序与依赖

```
阶段一（P0 + 阻断）  ← 无依赖，可立即开始
   ↓
阶段二（性能治理）    ← 建议先做 2.1 启动链路与 2.2 渲染，收益最直观
   ↓
阶段三（容错 → UI → 重构 → 工程化）
   注意：3.6 模块拆分必须放在 3.1~3.5 之后，
   否则重构与修 bug 并发进行，回归时无法区分是重构引入的还是原本就有的
```

优先级内再排序：**2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7**。

---

## 6. 风险与回滚

| 风险 | 应对 |
|---|---|
| `config.json` 结构变化（新增 `thumb` / `packVersion` / `accent`） | 一律向后兼容：缺字段回退旧行为；保留现有迁移代码并补测试路径 |
| 关闭 GPU 的黑屏问题复发 | 保留 `gpu-off.flag` 兜底开关，出问题可一键回到软件渲染 |
| 模块拆分引入回归 | 拆分前先补一份"行为快照"（IPC 输入输出对照），拆完逐条比对 |
| 删除 `dist-new` 误删在用分发包 | 删除前先确认正在使用的 exe 路径；建议先移入回收站而非直接删 |
| CSS 注入逻辑改动影响视觉效果 | 阶段三涉及 `transformDsCss` 的改动，需在真实主题包上做视觉对比后再合入 |

---

## 7. 不做的事（本次范围外）

- 不改动注入 CSS 的视觉设计语言（除非为修复 P3-1 的语法破坏）
- 不引入打包器 / 框架 / TypeScript（保持 `npx electron .` 即可跑的极简链路）
- 不新增联网功能（更新检查除外，仍只做只读查询）
- 不做配置云同步、多机迁移等非本地能力
