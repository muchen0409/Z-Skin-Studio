/* C5/C7/D3：命令行解析与主题定位、系统深浅色解析、日志尾部读取、A3 分区透明度 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { install } = require("./helpers/electron-mock");
const ctx = install();
const config = require("../src/config");
const { parseCliArgs, resolveThemeId } = require("../src/cli");
const { readTail, initLog, log } = require("../src/log");
const { resolveAppearance, buildSkinCss } = require("../src/skin");

/* ---------- C7 CLI ---------- */
test("parseCliArgs：三种命令与边界", () => {
  assert.deepEqual(parseCliArgs(["electron", ".", "--apply", "abc"]), { command: "apply", id: "abc" });
  assert.deepEqual(parseCliArgs(["exe", "--apply"]), { command: "apply", id: null });       // 缺参
  assert.deepEqual(parseCliArgs(["exe", "--apply", "--restore"]), { command: "apply", id: null }); // 值是旗标 → 视为缺参
  assert.deepEqual(parseCliArgs(["exe", "--restore"]), { command: "restore" });
  assert.deepEqual(parseCliArgs(["exe", "--status"]), { command: "status" });
  assert.deepEqual(parseCliArgs(["exe"]), { command: null });
  assert.deepEqual(parseCliArgs([]), { command: null });
  assert.deepEqual(parseCliArgs(["exe", "--restore", "--status"]), { command: "restore" }); // 首个命中生效
  assert.deepEqual(parseCliArgs(["exe", "--APPLY", "x"]), { command: null });               // 大小写敏感
});

test("resolveThemeId：id → 名称 → 前缀 → 未找到", () => {
  config.loadConfig();
  config.get().themes.push({ id: "uuid-1", name: "Aurora Sky" }, { id: "uuid-2", name: "晚风" });
  assert.equal(resolveThemeId("uuid-1"), "uuid-1");
  assert.equal(resolveThemeId("晚风"), "uuid-2");
  assert.equal(resolveThemeId("Aurora"), "uuid-1");   // 前缀
  assert.equal(resolveThemeId("不存在的"), null);
  assert.equal(resolveThemeId(""), null);
  assert.equal(resolveThemeId(null), null);
});

/* ---------- C5 系统深浅色 ---------- */
test("resolveAppearance：follow 不动、system 取系统、强制模式原样", () => {
  config.get().appearance = "follow";
  assert.equal(resolveAppearance(), null);
  config.get().appearance = "zai-light";
  assert.equal(resolveAppearance(), "zai-light");
  config.get().appearance = "system";
  assert.equal(resolveAppearance(), "zai-dark");      // mock 默认 shouldUseDarkColors=true
  ctx.nativeDark = false;
  assert.equal(resolveAppearance(), "zai-light");     // 系统浅色
  config.get().appearance = "follow";
});

/* ---------- D3 日志尾部 ---------- */
test("readTail：大文件取尾部且不出现半行，missing 处理正确", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "zskin-log-"));
  initLog(dir);
  const big = Array.from({ length: 2000 }, (_, i) => `2026-09-29T00:00:${String(i % 60).padStart(2, "0")} [tag] 行 ${i}`).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "diag.log"), big);
  const r = readTail(4096);
  assert.equal(r.missing, false);
  assert.ok(r.size > 4096);
  assert.ok(r.text.length <= 4096 + 200);             // 丢弃半行后仍应在量级内
  assert.ok(/^[0-9]{4}-/.test(r.text.split("\n")[0])); // 首行是完整时间戳行
  assert.ok(r.text.endsWith("\n"));

  const empty = readTail();
  assert.equal(empty.missing, false);                  // 同一文件，64KB 全量
  assert.ok(empty.text.includes("行 1999"));

  initLog(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "zskin-log2-")));
  const miss = readTail();
  assert.equal(miss.missing, true);
  assert.equal(miss.text, "");
});

test("log 正常写入后 readTail 可见", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "zskin-log3-"));
  initLog(dir);
  log("test", "hello-d3");
  const r = readTail();
  assert.ok(r.text.includes("hello-d3"));
});

/* ---------- A3 分区透明度 ---------- */
test("buildSkinCss：分区透明度覆盖对应分区且互不影响；缓存键区分 zoneAlpha", () => {
  const base = {
    id: "t", file: "C:\\bg\\a.jpg", alpha: 0.1, position: "center", shade: 0,
    accent: [255, 170, 102], filter: {},
  };
  const css = buildSkinCss({ ...base, zoneAlpha: { main: null, sidebar: 0.5, composer: null, dialog: null } }, false);
  assert.ok(css.includes("rgba(30, 30, 30, 0.5)"));     // 侧栏用 0.5
  assert.ok(css.includes("rgba(43, 43, 43, 0.1)"));     // 主区仍跟随全局
  assert.ok(css.includes("rgba(43, 43, 43, 0.28)"));    // 输入栏 = 0.1 + 0.18 偏移不变
  const other = buildSkinCss({ ...base, zoneAlpha: { main: 0.2, sidebar: 0.5, composer: null, dialog: null } }, false);
  assert.ok(other.includes("rgba(43, 43, 43, 0.2)"));
  assert.notEqual(other, css);                          // zoneAlpha 进入缓存指纹
  const none = buildSkinCss(base, false);
  assert.ok(none.includes("rgba(30, 30, 30, 0.1)"));    // 无 zoneAlpha 全部跟随全局
});

test("config：zoneAlpha 非法值归一化为 null，合法值保留", () => {
  const bg = path.join(ctx.userDataRoot, "bg.png");
  fs.writeFileSync(bg, "x");
  fs.writeFileSync(path.join(ctx.userDataRoot, "config.json"), JSON.stringify({
    themes: [{ id: "t1", name: "T", file: bg, zoneAlpha: { main: 0.4, sidebar: 5, composer: "x", dialog: null } }],
    appearance: "system",
  }));
  config.loadConfig();
  const t = config.get().themes[0];
  assert.equal(t.zoneAlpha.main, 0.4);
  assert.equal(t.zoneAlpha.sidebar, null);   // 越界 → 跟随全局
  assert.equal(t.zoneAlpha.composer, null);
  assert.equal(t.zoneAlpha.dialog, null);
  assert.equal(config.get().appearance, "system"); // C5：合法值被接受
});
