/* 换肤引擎纯函数：DreamSkin CSS 转换（@media/@keyframes/url 保护）、变量注入、CSS 构建缓存 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("./helpers/electron-mock");
install();
const { transformDsCss, dsVarsCss, buildSkinCss, DS_PART_ALIASES } = require("../src/skin");

test("普通规则：part 映射到真实 DOM + 声明 !important 化", () => {
  const out = transformDsCss('[data-ds-part="root"] { color: red; }');
  assert.ok(out.includes("html"));
  assert.ok(/color:\s*red !important/.test(out));
  assert.ok(!out.includes("data-ds-part"));
});

test("part 别名表与 DOM 兼容策略一致（v3.14.x 后代匹配）", () => {
  assert.equal(DS_PART_ALIASES.main, "#content section");
  assert.equal(DS_PART_ALIASES.root, "html");
});

test("@media 块递归处理：条件原样保留，内部规则仍被映射与 !important 化", () => {
  const css = '@media (min-width:768px){[data-ds-part="main"]{background:blue}}';
  const out = transformDsCss(css);
  assert.ok(out.includes("@media (min-width:768px){"));
  assert.ok(out.includes("#content section"));
  assert.ok(/background:\s*blue !important/.test(out));
  assert.ok(!/@media[^{]*!important/.test(out)); // 条件表达式不被误伤
});

test("@keyframes 内嵌结构原样保留（不映射不加 !important）", () => {
  const kf = "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}";
  const out = transformDsCss(kf + '\n[data-ds-part="sidebar"]{opacity:0.5}');
  assert.ok(out.includes(kf));
  assert.ok(out.includes("#sidebar"));
});

test("url(data:...) 声明整段保护：分号不截断 data URI", () => {
  const out = transformDsCss('div{background:url(data:image/png;base64,AAA=);color:red;}');
  assert.ok(out.includes("url(data:image/png;base64,AAA=)"));
  assert.ok(!out.includes("base64,AAA= !important"));
  assert.ok(/color:\s*red !important/.test(out));
});

test("url(http://...) 背景图声明同样保护", () => {
  const out = transformDsCss('.x{background-image:url(https://a.b/c.png);margin:1px;}');
  assert.ok(out.includes("url(https://a.b/c.png)"));
  assert.ok(/margin:\s*1px !important/.test(out));
});

test("大括号配平失败 → 返回 null（调用方回退通用皮肤）", () => {
  assert.equal(transformDsCss("div{"), null);
  assert.equal(transformDsCss("}div{"), null);
  assert.equal(transformDsCss("@media (min-width:1px){div{"), null);
  assert.equal(transformDsCss(""), "");
});

test("已带 !important 的声明不重复追加", () => {
  const out = transformDsCss("div{color:red !important;}");
  assert.equal((out.match(/!important/g) || []).length, 1);
});

test("dsVarsCss：hex 面板色转 rgba 半透明，rgba 字符串 line 原样保留", () => {
  const out = dsVarsCss({
    dsColors: {
      background: "#112233", panel: "#334455", accent: "#FFAA66",
      text: "#FFFFFF", line: "rgba(255,255,255,0.1)",
    },
  }, 0.10);
  assert.ok(out.includes("--ds-theme-color-panel: rgba(51, 68, 85, 0.28) !important")); // 0.10+0.18
  assert.ok(out.includes("--ds-theme-color-background: rgba(17, 34, 51, 0.18) !important")); // 0.10+0.08
  assert.ok(out.includes("--ds-theme-color-line: rgba(255,255,255,0.1) !important"));
  assert.ok(out.includes("--ds-theme-surface-radius: 12px"));
  assert.ok(!out.includes("undefined"));
});

test("buildSkinCss：滤镜/缩放抵消/背景 URL 注入，缓存命中返回同一实例", () => {
  const theme = {
    id: "t1", file: "C:\\bg\\a.jpg", alpha: 0.1, position: "center", shade: 0,
    accent: [255, 170, 102], filter: { blur: 8, brightness: 1, contrast: 1, saturate: 1 },
  };
  const css = buildSkinCss(theme, false);
  assert.ok(css.includes("filter: blur(8px);"));
  assert.ok(css.includes("transform: scale(1.032)")); // 1 + 8*0.004，抵消边缘羽化
  assert.ok(css.includes('url("file:///C:/bg/a.jpg")'));
  assert.ok(css.includes("rgba(43, 43, 43, 0.1)"));   // 深色主面板
  assert.equal(buildSkinCss(theme, false), css);       // 看门狗重注入直接命中缓存
  const other = buildSkinCss({ ...theme, filter: { blur: 0, brightness: 1, contrast: 1, saturate: 1 } }, false);
  assert.ok(!other.includes("blur(")); // 指纹变化后重新构建
});

test("buildSkinCss：blur 为 0 时不输出滤镜与缩放", () => {
  const css = buildSkinCss({
    id: "t2", file: "C:\\bg\\b.jpg", alpha: 0.1, position: "left", shade: 0,
    accent: [255, 170, 102], filter: {},
  }, false);
  assert.ok(!css.includes("filter:"));
  assert.ok(!css.includes("transform:"));
});
