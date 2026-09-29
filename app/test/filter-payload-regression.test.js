/* 回归 v2.1.0 首发缺陷：preload 把 extra 展开到 payload 顶层（{id,alpha,position,blur:8}），
   主进程最初只读 payload.filter.blur，导致滤镜滑块拖动后不落盘、UI 弹回原值。
   修复后 set-theme-params 必须同时接受扁平与嵌套两种形态——本文件固化该契约。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { install } = require("./helpers/electron-mock");
const ctx = install();
const config = require("../src/config");
const { register } = require("../src/ipc/themes");

config.loadConfig();
const bg = path.join(ctx.userDataRoot, "bg.png");
fs.writeFileSync(bg, "fake-image");
config.get().themes.push({
  id: "t1", name: "T", file: bg, alpha: 0.1, position: "center", shade: 0,
  filter: { blur: 0, brightness: 1, contrast: 1, saturate: 1 },
});
register();
const h = ctx.ipcHandlers;
const theme = () => config.get().themes[0];
const persisted = () => JSON.parse(fs.readFileSync(path.join(ctx.userDataRoot, "config.json"), "utf8")).themes[0];

test("扁平 payload（preload 展开形态）落盘", async () => {
  await h["set-theme-params"](null, { id: "t1", blur: 8 });
  assert.equal(theme().filter.blur, 8);
  assert.equal(persisted().filter.blur, 8); // 当时的 bug 表现就是不落盘
});

test("嵌套 payload（{filter:{...}} 形态）同样生效", async () => {
  await h["set-theme-params"](null, { id: "t1", filter: { blur: 12 } });
  assert.equal(theme().filter.blur, 12);
  assert.equal(persisted().filter.blur, 12);
});

test("滤镜参数边界钳制", async () => {
  await h["set-theme-params"](null, { id: "t1", blur: 100, brightness: 0.1, contrast: 99, saturate: 5 });
  assert.equal(theme().filter.blur, 20);
  assert.equal(theme().filter.brightness, 0.5);
  assert.equal(theme().filter.contrast, 1.5);
  assert.equal(theme().filter.saturate, 2);
});

test("非滤镜参数不受扁平键影响：alpha/position/shade 正常更新", async () => {
  await h["set-theme-params"](null, { id: "t1", alpha: 0.5, position: "left", shade: 2 });
  assert.equal(theme().alpha, 0.5);
  assert.equal(theme().position, "left");
  assert.equal(theme().shade, 2);
  await h["set-theme-params"](null, { id: "t1", alpha: 5, shade: 9 }); // 越界值被拒
  assert.equal(theme().alpha, 0.9);
  assert.equal(theme().shade, 2);
});

test("未知主题 id：静默忽略且不崩", async () => {
  const before = JSON.stringify(theme());
  await h["set-theme-params"](null, { id: "nope", blur: 5 });
  assert.equal(JSON.stringify(theme()), before);
});

test("publicState 形状完整（fake electron 版本号贯穿）", () => {
  const s = config.publicState();
  assert.equal(s.appVersion, "0.0.0-test");
  assert.ok(Array.isArray(s.themes));
  assert.ok("gpuOff" in s);
});
