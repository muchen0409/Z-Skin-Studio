# Zcode+ 管理控制台 · 优化计划书 V2（skills 赋能版）

> 2026-09-29 基于 **v2.2.0 基线** 与本机新装 skills 资产产出。
> 前版 `OPTIMIZATION_PLAN.md`（2026-09-26）已随 v2.0.0 全量落地，其 20 项全部关闭，本版不再重复；
> `FEATURE_PROPOSALS.md` 中未实施的功能提案只在本版第六章按新标准重排，不另立文档。
> 本计划书只做规划，不含实际代码改动。

---

## 0. 结论先行

| 项 | 内容 |
|---|---|
| 基线 | v2.2.0，约 3500 行：`main.js` 182 行 + `src/` 12 模块 + `ui/` 三件套，结构健康 |
| 最大风险 | **零测试 + 零 CI + 发布手工**。两次真实回归（v2.1.0 滤镜滑块因 preload 硬链接断链"修了还坏"、v2.2.0 社区元数据驼峰命名误判）都是靠人肉发现——教训还在记忆里，没有变成机制 |
| 新资产 | 本机新装 80+ skills；与本项目直接相关的约 20 个，已逐个映射到工作项（见 §2） |
| 执行策略 | 四阶段递进：**测试地基 → CI/CD 流水线 → 安全与生产审计 → 功能迭代**；文档治理与 skills 自身治理贯穿全程 |
| 第一步 | 用 Node 内建 `node:test` 给 5 个纯逻辑模块补单测，并给两个历史 bug 各补一条回归测试（约半天，零新依赖） |

**本计划全程遵守既有三条红线**（FEATURE_PROPOSALS §0）：不改 ZCode 文件、不读不上传聊天数据、保持"非官方第三方"定位。所有阶段新增的 CDP/联网行为仍需在 README 安全声明同步登记。

---

## 1. 基线与差距

### 1.1 已完成、不再列入本计划的

v2.0.0 全量优化（稳定性/性能/容错/结构/工程化）、v2.1.0 推荐功能组合（D1 诊断 / D2 选择器健康 / C1 自启 / A4 预览 / A1+A2 滤镜遮罩 / C3 热键 / C2 托盘菜单）、v2.2.0 社区主题（DreamSkin.cc 受限只读）与三卡拆分。代码已模块化、配置原子写、统一日志、CSP 收紧——前版计划的欠账已还清。

### 1.2 当前差距总表

| 编号 | 缺口 | 证据 | 后果 |
|---|---|---|---|
| G1 | 零测试 | `package.json` 无 `test` script，无任何测试文件 | 回归只能靠人肉冒烟；纯逻辑（版本比较、CSS 转换、社区校验）改一行全凭手感 |
| G2 | 零 CI | 仓库无 `.github/`；push 到 GitHub 无任何自动检查 | 教训无法固化成门禁；`main` 直接提交，无 PR 审查环节 |
| G3 | 发布手工 | `build.mjs` 本地跑，产物 `dist-new/` 被 gitignore，无 GitHub Release | 分发不可追溯；换机器要重新摸索构建 |
| G4 | 部署陷阱未设防 | 根文件硬链接部署，Edit/Write 原子替换会静默断链（v2.1.0 事故真因），目前只靠"记得跑 `npm run deploy`" | 已发生过一次；换环境或 AI 会话必踩 |
| G5 | 无 lint/格式化 | 无 eslint/prettier/editorconfig | 多会话协作风格漂移 |
| G6 | 关键决策无沉淀 | PowerShell 启动绕 Mimosa 钩子、junction 部署、IIFE 隔离 CDP 等只存在于本机 `~/.zcode` 私有记忆 | 仓库公开后其他环境/协作者读不到，同坑重踩 |
| G7 | 文档无治理规则 | 根目录 4 份 md + 2 份计划书，无分工与更新时机约定 | 文档 rot：README 与实际行为漂移无人察觉 |
| G8 | 唯一联网面未经审计 | `src/community.js`（下载链路）+ 本地 zip 解析（adm-zip）从未做过系统安全扫描 | 社区主题是攻击面：恶意 zip / 恶意元数据 |
| G9 | UI 触点无系统审查 | v2.2.0 拆三卡后按钮/状态位增多 | 异常态互斥（opBusy、导入失败后）容易出现"按钮能点但行为错" |

---

## 2. 新装 skills 资产映射

80+ skills 按与本项目的关系分三档。**主用档**才进入阶段计划；按需档点名场景；不适用档明确排除，避免每个会话都被无关 skills 占上下文（治理见 §8）。

### 2.1 主用档（直接进入计划）

| Skill | 能力 | 映射到 |
|---|---|---|
| `tdd-workflow` | TDD 流程 + 覆盖率门禁 | 阶段一：纯逻辑模块单测 |
| `ai-regression-testing` | AI 辅助开发的回归测试策略 | 阶段一：历史 bug 回归；此后每个 bugfix 先补测试 |
| `verification-loop` | 会话收尾前系统验证 | 所有阶段：改完必跑清单 |
| `delivery-gate` | stop hook 质量门禁 | 阶段二起：拦截"未验证就收工" |
| `git-workflow` | 分支/conventional commits/rebase 规范 | 阶段二：分支模型（已在用 `fix(community):` 风格，予以固化） |
| `github:workflow-run` / `github:pr` / `github:release` | GitHub Actions / PR / Release 操作 | 阶段二：CI 与发布流水线的操作入口 |
| `mimosa-security-scan`（MCP 工具已装） | 项目深度安全扫描 | 阶段三：community.js 下载链路 + 全仓扫描 |
| `production-audit` | 本地证据生产就绪审计 | 阶段三：打包产物、崩溃路径、日志可用性 |
| `error-handling` | 类型化错误/重试/降级模式 | 阶段三：CDP 与社区下载链路的错误分级 |
| `intent-driven-development` | 高影响改动先定验收标准 | 阶段四：每个新功能先写验收再动手 |
| `click-path-audit` | 用户触点全状态链路审查 | 阶段四：三卡拆分后的 UI 异常态审查 |
| `architecture-decision-records` | 决策记录 ADR | 贯穿：把 6 个隐性决策显式化（§7.2） |
| `living-docs-governance` | 文档分工与防腐 | 贯穿：根目录文档治理（§7.1） |
| `browser-qa` / `e2e-testing` | 浏览器/Electron 自动化测试 | 阶段一/四：renderer 自动化（Playwright `_electron` 与项目既有 CDP 基建同源） |

### 2.2 按需档（出现场景再用）

| Skill | 场景 |
|---|---|
| `santa-method` / `council` | 社区安全模型变更、选择器策略调整等争议性决策时做对抗评审 |
| `codehealth-mcp` | 若接入 CodeScene，用于重构前后健康度对比（可选，不强制） |
| `ui-ux-pro-max` / `frontend-design` / `inherit-legacy-style` | 阶段四做 UI 改版时使用；改版必须保持现有深浅色/三卡结构风格 |
| `code-tour` / `codebase-onboarding` | 若仓库对外公开，生成 walkthrough |
| `windows-desktop-e2e`（pywinauto） | 打包 exe 的系统级冒烟；与 Playwright 二选一即可，优先 Playwright |
| `growth-log` / `continuous-learning-v2` | 每阶段收尾沉淀一条经验进记忆 |
| `agent-self-evaluation` | 每个阶段交付后自评一次 |

### 2.3 不适用档（明确排除，不进入本项目会话）

figma 全家（无设计稿流程）、lark-cli、ios/android-dev、codespace、skill-creator/plugin-creator（本项目不产出 skill/plugin）、e2e 之外的 eval-harness/dev-team/hookify-rules 等流程实验类——对本项目收益为负（上下文成本 > 收益）。

---

## 3. 阶段一：测试地基（最高优先级）

**目标**：消灭 G1。让"改坏了"在提交前就暴露，而不是在用户实例上。

### 3.1 工具选型

`node:test`（Node ≥20 内建，零新依赖）+ 少量自写断言辅助。**不引入** jest/vitest——保持"极简链路"红线，测试工具属于 devDependencies 之外的白嫖。
Electron 相关 I/O 模块（cdp/skin 的注入部分）不做强制覆盖；只测纯逻辑。

### 3.2 单测清单（按风险排序）

| 目标模块 | 测什么 | 用法提示 |
|---|---|---|
| `src/zcode.js` cmpVersion | `1.2.3` vs `v1.2.3-beta` vs 多段数字；历史上 100% 崩过的函数 | 纯函数直接测 |
| `src/skin.js` transformDsCss | `@media`/`@supports` 递归、`@keyframes` 保留、`url(data:;base64)` 不被分号截断、大括号配平失败回退 | 若与 CDP 耦合，先把纯转换函数抽到无依赖位置 |
| `src/community.js` | 驼峰/帕斯卡两种元数据命名、缺 PackageBytes/Sha256 拒绝、`applyCompatible:false` 与 `reviewedAt` 为空拒绝、路径白名单正则（ver_ 大小写敏感）、URL 构造只出 https+固定 host | 网络层 mock `http` 模块 |
| `src/config.js` | 原子写中断模拟（写 tmp 不 rename）、`.bak` 恢复路径、坏 JSON 恢复 | 临时目录中真实 fs 操作 |
| `src/theme-pack.js` | zip 解析短路条件（packVersion 回填）、3 秒软超时、缩略图字段向后兼容 | 构造小 zip fixture |

### 3.3 回归测试（教训变资产）

- **回归 1**：preload payload 扁平 `{blur:8}` 与嵌套 `{filter:{blur:8}}` 两种形态都必须落盘（v2.1.0 滤镜事故）。
- **回归 2**：真实驼峰元数据样本能导入成功（v2.2.0 事故）——把线上响应的脱敏样本存为 fixture。
- 此后约定（`ai-regression-testing` 流程）：**每个 bugfix 的 PR 必须携带一条能复现原 bug 的测试**，否则不接受。

### 3.4 部署一致性校验（顺手消灭 G4 的检测面）

新增 `test/deploy-check.mjs`：遍历 `dist-new/.../resources/app/` 下的硬链接文件与 junction 目录，逐文件读 buffer 与源比对，不一致即失败。本地 `npm test` 跑、阶段二进 CI 也跑。**它防不了断链本身，但能把"生产跑旧代码"从静默事故变成显式红灯。**

### 3.5 renderer 冒烟（可选，次优先）

Playwright（devDependency）`_electron.launch` 起 app，断言三页导航、启用/恢复按钮状态机。与项目自身 CDP 排查经验同源，成本低。首版只覆盖"冷启动 → 状态栏出现 → 切三页不报错"。

**验收**：`npm test` 一键全绿；两个历史 bug 各有一条测试；覆盖率不设硬指标（先有后再谈 80%）。

---

## 4. 阶段二：CI/CD 与发布流水线

**目标**：消灭 G2/G3。push 有门禁，打 tag 出包，发布可追溯。

### 4.1 GitHub Actions

| 工作流 | 触发 | 内容 | Runner |
|---|---|---|---|
| `ci.yml` | push / PR | `npm test`（含 deploy-check）+ `npm audit --omit=dev` + 后续接入 lint | ubuntu（单测足够快） |
| `release.yml` | tag `v*` | windows runner：`npm run dist` → 产物附到 GitHub Release，release notes 取自 CHANGELOG 对应小节 | windows-latest（Electron Windows 产物必须在 Windows 打） |

操作入口用 `github:workflow-run` / `github:pr` / `github:release` skills。

### 4.2 分支模型（`git-workflow` 固化现状）

- `main` 保护：禁止直接 push（个人项目用"开分支 → PR → 自己合"的最小流程即可，不搞 review 形式主义）。
- conventional commits 延续现风格：`fix(community): …` / `feat(skin): …`。
- bugfix PR 必带回归测试（§3.3 约定的门禁点）。

### 4.3 验收

- 向 `main` 提交一个故意打错元数据字段的改动 → CI 红灯并指出是哪条测试。
- 打 `v2.3.0` tag → GitHub Release 自动出现带 exe 的产物。

---

## 5. 阶段三：安全与生产审计

**目标**：消灭 G8/G5。社区主题是本应用唯一攻击面，上线了就必须体检。

### 5.1 安全扫描（`mimosa-security-scan`，MCP 工具可直接调）

- 深度扫描整个 `app/`，`focusFiles` 指定 `src/community.js`、`src/ipc/community.js`、`src/theme-pack.js`（adm-zip 解析不可信 zip 的路径遍历/超压缩炸弹面）。
- 核对点：URL 白名单是否可能被 path 绕过（`//`、编码字符、`\`）、3xx 拒绝是否有遗漏分支（redirect 手工处理处）、SHA-256 比较是否非常数时间（低危但顺手）、zip 条目路径是否防 `../` 逃逸、32MiB 上限是否在解压前判断。
- 结论与豁免记录写进 `docs/security-audit-2026-09.md`，README 安全声明引用。
- `npm audit` 结果进 CI（阶段二已列），高危必须修或有豁免理由。

### 5.2 错误处理分级（`error-handling`）

CDP 与社区下载链路错误统一分级：`user-fixable`（可读文案+修复建议，走 D1 诊断话术）/ `transient`（退避重试）/ `fatal`（日志+状态栏）。当前 `diag.log` 已统一，但错误"给人看"与"给日志看"未分层；只做约定与改造，不引库。

### 5.3 生产就绪审计（`production-audit`）

对 `dist-new` 打包产物过一遍：exe 双击冷启动、`gpu-off.flag` 兜底、托盘驻留 30 分钟 CPU、崩溃后 config 恢复。产出 checklist 存 `docs/`。

**验收**：扫描无未处理高危；审计清单全绿；扫描报告入库。

---

## 6. 阶段四：功能迭代（剩余提案重排）

**目标**：把 FEATURE_PROPOSALS 剩余项用新标准（先验收后动手、每功能带测试）重排。用 `intent-driven-development` 给每项写验收标准后再实施。

### 6.1 推荐实施序

| 序 | 功能 | 理由（相对 v2.1 时排序的变化） |
|---|---|---|
| 1 | **B1 导出主题包 + B2/D4 备份迁移** | 社区主题已上线，"能进"还需"能出/能备份"才形成双向生态；且导出格式与导入校验共用代码，先有测试保护再动 |
| 2 | **A3 分区透明度** | 滤镜/遮罩已就位，分区 alpha 是效果上限的最后一块，成本低感知强 |
| 3 | **C5 跟随系统深浅色** | 与 `appearance: follow` 天然契合，S 成本 |
| 4 | **C7 命令行调用**（`--apply/--restore/--status`） | 被 CI/脚本调用的基建价值在阶段二之后才显现；S 成本 |
| 5 | **D3 日志查看页完整版**（现有"打开日志目录"升级为页内查看/过滤/导出） | 阶段三错误分级落地后，日志消费需求上升 |

### 6.2 UI 触点审查（`click-path-audit`，随第一个 UI 功能一并做）

三卡拆分后逐按钮过异常态矩阵：opBusy 期间、ZCode 未运行、社区导入失败后、选择器 degraded 告警时——每个触点确认"可见性 × 可点性 × 点击后状态迁移"三者一致。

### 6.3 明确不做（维持原判）

在线主题市场自建服务端、任何数据上传、插件系统、跟随前台应用/电量换肤。理由见 FEATURE_PROPOSALS §3，不重复。

**验收**：每功能一项 PR，含验收标准 + 测试 + CHANGELOG 条目。

---

## 7. 贯穿项：文档治理与仓库内 AI 上下文

### 7.1 文档分工（`living-docs-governance`）

| 文档 | 定位（宪法角色） | 更新时机 |
|---|---|---|
| `README.md` | 用户视角：是什么/怎么用/安全声明 | 行为变化随 PR 同步 |
| `app/CHANGELOG.md` | 版本事实记录 | 每个 PR 必带条目 |
| `FEATURE_PROPOSALS.md` | 提案池（标注已实施/已否决状态） | 实施或否决时更新状态列 |
| `OPTIMIZATION_PLAN.md` / `_V2.md` | 历史计划（只读归档，完成后标状态） | 完成时头部加"已落地"标注 |
| `docs/`（新建） | 审计报告、ADR、运维 checklist | 随阶段产出 |

### 7.2 ADR：把隐性决策显式化（`architecture-decision-records`）

以下 6 个决策目前只在本机记忆里，落成 `docs/adr/`（每篇半页：背景/决策/后果）：

1. 用 PowerShell `Start-Process` + 环境变量传路径启动 ZCode（Mimosa 钩子禁 spawn 变量 exe）
2. junction + 硬链接部署模型，根文件改动必须 `npm run deploy`
3. `gpu-off.flag` 开关式禁用 GPU（历史黑屏兜底）
4. CDP `Runtime.evaluate` 一律 IIFE 隔离作用域（共享全局的教训）
5. 社区主题"受限只读"安全模型（host 白名单/禁重定向/SHA-256/32MiB）
6. 换肤选择器用后代匹配 `#content section` 兼容 v3.14.x 结构变化

### 7.3 仓库内 AI 协作文件（消灭 G6）

新建根目录 `AGENTS.md`（或 CLAUDE.md，一即可）：部署硬链接陷阱、config.json.bak require 陷阱、冒烟测试技巧（单实例锁占用时复制到 `-test` 目录）、三条红线、`npm test`/`npm run deploy` 必跑时机。**记忆是本机私有的，仓库公开后其他环境只能靠这份文件。**

---

## 8. Skills 自身治理（防止 80+ skills 变成负资产）

新装 skills 数量庞大，每次会话全量可见，存在上下文成本与"误用花哨流程"风险：

- 用 `context-budget` 做一次审计，确认常驻 skills 对上下文的占用；
- 用 `config-gc` 清理与本机工作流无关的项（figma、lark、ios/android 对本项目无用，但可能对其他项目有用——按项目启用而非全局禁用）；
- 本项目的"主用清单"以 §2.1 为准，会话内不主动调用 2.3 档；
- 每阶段结束用 `growth-log` 沉淀一条经验（好用的 skill 组合 / 无效的流程），滚动修正这份映射表。

---

## 9. 执行顺序与工作量估算

```
阶段一 测试地基     ◄── 无依赖，立即开始；半天～1 天
   ↓
阶段二 CI/CD        ◄── 依赖阶段一（CI 跑的就是它）；半天
   ↓
阶段三 安全与审计   ◄── 依赖阶段二（npm audit 进 CI）；半天～1 天
   ↓
阶段四 功能迭代     ◄── 依赖阶段一测试保护；按 6.1 顺序逐个 PR
（贯穿）文档治理 §7 可与任何阶段并行；§8 一次性半小时
```

单人 + 学生 + 多项目并行，每个阶段都设计为**独立可交付、可中断**：阶段一做完即使停在原地，项目也已经比现在安全。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 纯逻辑函数与 Electron I/O 耦合，单测抽不动 | 允许小幅抽函数（移动不改行为），抽动本身进 ADR；不为覆盖率做伤筋动骨的重构 |
| Playwright 拉起 Electron 与生产实例单实例锁冲突 | 复用既有 `-test` userData 技巧（记忆已验证）；CI 上无此问题 |
| windows runner 打包慢/偶发失败 | release.yml 允许手动重跑（`github:workflow-run`）；产物校验以 SHA-256 记录在 Release 页 |
| 安全扫描报出大量低危噪音 | 只对高危/中危设门禁，低危记录豁免理由 |
| skills 流程过重拖慢日常小改动 | §2.3 档不进会话；`delivery-gate` 等门禁类仅对阶段交付启用，日常微调不强制 |

---

## 11. 范围外（本计划不做）

- 不引入 TypeScript / 打包器 / UI 框架（维持 `npx electron .` 可跑的极简链路）
- 不做自更新自动下载（D7 只读提示可并入阶段四，策略另议）
- 不做配置云同步 / 多机实时同步（红线冲突；B2 本地归档迁移已覆盖需求）
- 不为覆盖率指标而写快照式无断言测试
