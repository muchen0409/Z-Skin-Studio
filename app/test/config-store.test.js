/* 配置存储：原子写、.bak 自愈、旧结构迁移、字段校验回填 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { install, freshRoot } = require("./helpers/electron-mock");
const ctx = install(); // 必须先于 require("../src/config")
const config = require("../src/config");

const readMain = () => JSON.parse(fs.readFileSync(path.join(ctx.userDataRoot, "config.json"), "utf8"));
const switchRoot = () => { ctx.userDataRoot = freshRoot(); return ctx.userDataRoot; };
const writeRaw = (name, content) => fs.writeFileSync(path.join(ctx.userDataRoot, name), content);
const makeBg = () => {
  const f = path.join(ctx.userDataRoot, "bg.png");
  fs.writeFileSync(f, "fake-image");
  return f;
};

test("全新目录：产出默认配置，原子写无 .tmp 残留", () => {
  switchRoot();
  config.loadConfig();
  assert.ok(fs.existsSync(path.join(ctx.userDataRoot, "config.json")));
  const c = config.get();
  assert.deepEqual(c.themes, []);
  assert.equal(c.draftId, null);
  assert.equal(c.appliedId, null);
  assert.equal(c.appearance, "follow");
  assert.equal(c.rotation.intervalMin, 60);
  assert.equal(c.hotkeys.enabled, true);
  assert.equal(fs.existsSync(path.join(ctx.userDataRoot, "config.json.tmp")), false);
});

test("旧结构迁移：backgrounds/selectedId/panelAlpha → themes/draftId", () => {
  switchRoot();
  const bg = makeBg();
  writeRaw("config.json", JSON.stringify({
    backgrounds: [{ id: "a", name: "Old", file: bg }],
    selectedId: "a",
    panelAlpha: 0.2,
  }));
  config.loadConfig();
  const c = config.get();
  assert.equal(c.themes.length, 1);
  assert.equal(c.themes[0].id, "a");
  assert.equal(c.themes[0].alpha, 0.2);
  assert.equal(c.themes[0].position, "center");
  assert.equal(c.draftId, "a");
  assert.equal(c.appliedId, null);
  assert.equal("backgrounds" in c, false);
  assert.equal("selectedId" in c, false);
  assert.equal("panelAlpha" in c, false);
});

test("主题缺 filter/shade 字段时回填默认值（A1/A2 向后兼容）", () => {
  switchRoot();
  const bg = makeBg();
  writeRaw("config.json", JSON.stringify({ themes: [{ id: "t1", name: "T", file: bg }] }));
  config.loadConfig();
  const t = config.get().themes[0];
  assert.deepEqual(t.filter, { blur: 0, brightness: 1, contrast: 1, saturate: 1 });
  assert.equal(t.shade, 0);
  assert.equal(t.alpha, 0.10);
});

test("指向不存在文件的主题被过滤", () => {
  switchRoot();
  const bg = makeBg();
  writeRaw("config.json", JSON.stringify({
    themes: [
      { id: "keep", name: "K", file: bg },
      { id: "gone", name: "G", file: "Z:\\nonexistent\\never.png" },
    ],
  }));
  config.loadConfig();
  assert.deepEqual(config.get().themes.map(t => t.id), ["keep"]);
});

test("主文件损坏时从 .bak 自愈（先两次加载让 .bak 落盘）", () => {
  switchRoot();
  config.loadConfig();
  config.loadConfig(); // 第二次保存时才会复制出 .bak
  writeRaw("config.json", "{broken json");
  config.loadConfig();
  assert.equal(config.get().themes.length, 0); // .bak 里是上次成功内容
  assert.ok(fs.existsSync(path.join(ctx.userDataRoot, "config.json")));
});

test("主文件与 .bak 均损坏：重建并留档损坏文件", () => {
  switchRoot();
  writeRaw("config.json", "{broken");
  config.loadConfig();
  assert.ok(Array.isArray(config.get().themes));
  assert.ok(fs.readdirSync(ctx.userDataRoot).some(f => /^config\.json\.bak-\d+$/.test(f)));
});

test("saveConfig：.bak 保留上次成功内容，主文件写新内容，无 .tmp 残留", () => {
  switchRoot();
  config.loadConfig();
  config.loadConfig();
  config.get().appearance = "zai-dark";
  config.saveConfig();
  assert.equal(readMain().appearance, "zai-dark");
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.userDataRoot, "config.json.bak"), "utf8")).appearance, "follow");
  assert.equal(fs.existsSync(path.join(ctx.userDataRoot, "config.json.tmp")), false);
});

test("非法 appearance / rotation 值被纠偏为默认", () => {
  switchRoot();
  const bg = makeBg();
  writeRaw("config.json", JSON.stringify({
    themes: [{ id: "t1", name: "T", file: bg }],
    appearance: "solarized",
    rotation: { enabled: "yes", intervalMin: 7, order: "shuffle" },
  }));
  config.loadConfig();
  const c = config.get();
  assert.equal(c.appearance, "follow");
  assert.equal(c.rotation.enabled, false);
  assert.equal(c.rotation.intervalMin, 60);
  assert.equal(c.rotation.order, "sequential");
});
