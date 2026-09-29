# 安全审计报告 · 2026-09-29

> 对应 OPTIMIZATION_PLAN_V2.md 阶段三 §5.1。结论先行：**代码发现 0 条；运行时依赖 0 漏洞；
> 开发链 3 条高危（extract-zip，仅打包期触达）按豁免记录**。本报告基于静态扫描与依赖审计，
> 不是运行时验证。

---

## 1. 扫描元数据

| 项 | 值 |
|---|---|
| 工具 | Mimosa 深度扫描（static_only_no_runtime_execution） |
| Scan ID | `scan-2026-09-29T03-59-05.716Z-ecaa5dc63a64` |
| 封印 | `sha256:aab059ae…421f89`（完整值见扫描目录 seal.json） |
| 重点文件 | `app/src/community.js`、`app/src/ipc/community.js`、`app/src/theme-pack.js` |
| 源码覆盖 | 28/28 文件全部解析，无截断、无读取失败 |
| 路径分析 | 521 函数 / 841 调用边 |
| 代码发现 | **0**（高危 0 / 中 0 / 低 0 / 业务逻辑 0） |

**覆盖缺口（诚实声明）**：调用图部分不完整——Electron IPC handler 经 `ipcMain.handle` 动态派发，
跨文件可达性分析无法完全展开。缓解：核心安全路径（社区下载链路、zip 解析）已由单元测试
直接覆盖（见 §3），且 ipc handler 与实现同文件就近可读。

## 2. 依赖审计结论

| 范围 | 结果 | 门禁 |
|---|---|---|
| 运行时依赖（adm-zip 0.6.1、ws 8.18.0） | **0 漏洞** | CI `npm audit --omit=dev --audit-level=high` 通过 |
| 开发链（electron 33.4.11、@electron/packager 18.x） | 3 高危：extract-zip 符号链接路径穿越 / 归档符号链接任意写（GHSA-jmr9-qjv8-65gv、GHSA-7pqw-9j4j-h8q3 及关联） | 豁免，理由见下 |

**豁免理由**：extract-zip 的漏洞利用前提是**解包攻击者构造的 zip**。本项目两条触达路径都
不满足该前提——

1. electron npm 包 postinstall 与 @electron/packager 解的是**官方发布**的 `electron-v33-win32-x64.zip`（来源固定，非用户输入）；
2. 用户侧不可信 zip（社区主题包 / 本地导入包）走的是 **adm-zip**（运行时依赖，0 漏洞），
   且导入前后有独立防线：字节级大小比对 + SHA-256 校验 + 32MiB 上限 + 背景图路径白名单（`..` 拒绝），
   相关逻辑已固化为单元测试（`test/community-meta.test.js`、`test/theme-pack.test.js`）。

**遗留动作**（不阻塞，记入后续迭代）：electron 33 → 新主版本升级是独立任务（audit 提示的唯一
修复路径是 electron@44，破坏性变更），需整体回归测试后再做；升级前保持 dev 链离线使用。

## 3. 人工核对点（计划 §5.1 清单 → 现状）

| 核对点 | 现状 | 证据 |
|---|---|---|
| URL 白名单绕过（`//`、编码、`\`、host 伪装、凭据内嵌、IP 字面量） | `assertApiUri` 统一出口校验，3xx 一律拒绝不跟随 | `test/community-meta.test.js` 白名单用例逐项覆盖 |
| SHA-256 比较是否非常数时间 | 使用 `hash.digest("hex") !== meta.sha256` 普通比较 | 非常数时间理论上可侧信道计时；但 sha 值来自**服务器元数据**而非密钥，无可保护秘密，风险不成立，不改 |
| zip 条目 `../` 逃逸 | 背景图路径 `..` 直接拒绝 + 落盘路径 `startsWith(root + sep)` 显式边界 | `importThemePack` + 单测覆盖 |
| 32MiB 上限是否解压前判断 | 元数据 `packageBytes` 阶段即拒绝（`bytes > MAX_PACK`），下载流超登记值即中止 | `normalizeMeta` / `downloadPack` + 单测覆盖 |
| 元数据 64KiB 双重上限 | Content-Length 与累计字节双重检查 | `fetchMeta`（网络层，未单测；逻辑简单直读） |

## 4. 结论

- 阶段三扫描与审计动作完成，无需要立即修复的发现。
- CI 依赖审计门禁（仅运行时依赖）自 aff8d0a 起生效。
- 本报告入库后，README 安全声明引用本文件作为年度审计记录。
