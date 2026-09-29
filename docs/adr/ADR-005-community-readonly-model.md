# ADR-005：社区主题"受限只读"安全模型

- 状态：已接受（2026-09-28 起）
- 关联：`app/src/community.js`、`app/src/ipc/community.js`、README 安全声明

## 背景

FEATURE_PROPOSALS B10（在线主题源）最初被否决，理由是"需要服务端托管、与不联网声明冲突"。
v2.2.0 找到折中：不自建服务端，仅当用户主动粘贴主题 ID 时，从 DreamSkin.cc 固定接口
**只读**下载。

## 决策

对齐上游客户端（Codex-Dream-Skin）同款防护，全部在主进程实现：

1. 仅 `https` + 固定 host `api.dreamskin.cc` + 精确路径正则白名单
   （`^/v1/themes/(ver_[a-z0-9]{8,64})(/download)?$`），出口统一校验 `assertApiUri`；
2. 3xx 一律拒绝、不跟随重定向；
3. 元数据 64KiB 双重上限，必须携带登记的 `packageBytes` 与 `packageSha256`；
4. 包体流式下载：字节级大小比对 + SHA-256 校验 + 单包 32MiB 硬上限，任一不符即丢弃；
5. 上游前置检查：`applyCompatible:false` 与 `reviewedAt` 为空拒绝导入；
6. 渲染层零远程内容（CSP 未放宽），仅在用户主动点击时发起 GET，不上传任何数据。

**线上 API 元数据是驼峰命名**（`packageBytes/packageSha256/name/authorDisplayName`），
客户端脚本里的帕斯卡写法是内部归一化形状；两种命名都兼容（`normalizeMeta`，有单测）。

## 后果

- 正面：无服务端、无爬取、无再分发；完整性与审核状态均有据可依。
- 负面：依赖单一社区 API 的可用性与 schema 稳定性（字段命名演进需兼容层跟踪）。
- 约束：ver_ ID 正则**大小写敏感**；新增任何网络调用必须登记进 README 安全声明。
