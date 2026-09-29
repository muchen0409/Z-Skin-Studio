# ADR-006：换肤选择器用后代匹配兼容 DOM 演进

- 状态：已接受（2026-09-26 起）
- 关联：`app/src/skin.js` DS_PART_ALIASES、`app/src/diag.js` 选择器健康检查

## 背景

换肤 CSS 依赖 ZCode 的内部 DOM 结构（`#root` / `#sidebar` / `.bg-input` / `.bg-surface` /
`#content section`），而 ZCode 没有任何宿主钩子或主题 API——结构一变选择器就失效，
用户只会觉得"工具坏了"。

## 决策

1. 主区选择器用**后代匹配** `#content section` 而非直接子元素 `#content > section`：
   ZCode v3.14.x 起 section 被包进一层 div，后代匹配同时兼容新旧结构。
2. DreamSkin 包样式的 part 映射收敛在 `DS_PART_ALIASES` 一张表里，DOM 变化只改一处。
3. D2 选择器健康检查：诊断时记录 `#root` / `#content section` / `#sidebar` /
   `.bg-input` / `.bg-surface` 命中数 + ZCode 版本快照（config.selectorStats）；
   版本变化 → stale、核心选择器归零 → degraded，状态栏 ⚠ 主动告警。

## 后果

- 正面：上线即抓到 v3.14.x 的真实兼容性问题；ZCode 升级后用户看到的是告警而非"玄学失效"。
- 负面：后代匹配理论上可能误中嵌套的同名节点；当前 DOM 下实测无副作用。
- 约束：选择器清单变更时 `skin.js` 与 `diag.js` 必须同步。
