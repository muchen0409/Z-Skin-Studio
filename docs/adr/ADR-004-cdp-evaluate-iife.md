# ADR-004：CDP Runtime.evaluate 一律用 IIFE 隔离作用域

- 状态：已接受（2026-09-27 起）
- 关联：`app/src/skin.js`（injectJs/removeJs/appearanceJs）、`app/src/diag.js`

## 背景

CDP 的 `Runtime.evaluate` 脚本共享页面的全局作用域。调试中曾用 `const el = ...` 声明
临时变量：同一页面第二次 evaluate 再声明 `const el` 时抛 SyntaxError 并**静默失败**，
表现为"第一个操作成功、后续全部失败"的假象，极难定位。

## 决策

所有发往页面的 evaluate 脚本一律包裹为 `(function(){ ... })()` 或
`(async () => { ... })()`，不向页面全局泄露任何标识符；脚本内部错误自行 try/catch
返回字符串错误（`"ERR:" + message`），由主进程判别。

## 后果

- 正面：多次 evaluate 互不污染；ZCode 页面的全局对象不被覆盖（红线：不改业务行为）。
- 负面：脚本体积略增、调试时需进入 IIFE 断点。可接受。
