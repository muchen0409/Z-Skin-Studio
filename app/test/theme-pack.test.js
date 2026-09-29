/* 主题包解析：zip 结构定位、路径安全、token 映射、启动回填；取色辅助纯函数 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { install, freshRoot } = require("./helpers/electron-mock");
const ctx = install(); // 必须先于 require("../src/theme-pack")
const config = require("../src/config");
const { importThemePack, hexToRgb, normalizeAccent, backfillPackThemes } = require("../src/theme-pack");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const THEME_META = {
  id: "pack-x", name: "Pack", packageVersion: "2.5", image: "bg.png",
  colors: { accent: "#FFAA66", background: "#112233", panel: "#334455", text: "#FFFFFF" },
  art: { focusX: 0.2 },
};
const PACK_CSS = '[data-ds-part="root"]{color:red}';

function makePackZip({ dirPrefix = "", meta = THEME_META, withTheme = true, withCss = true, withImage = true } = {}) {
  const AdmZip = require("adm-zip");
  const zip = new AdmZip();
  const p = n => dirPrefix + n;
  if (withTheme) zip.addFile(p("theme.json"), Buffer.from(JSON.stringify(meta)));
  if (withCss) zip.addFile(p("theme.css"), Buffer.from(PACK_CSS));
  if (withImage) zip.addFile(p("bg.png"), TINY_PNG);
  if (!withTheme && !withCss && !withImage) zip.addFile("readme.txt", Buffer.from("nothing"));
  return zip;
}

function loadPack(zip) {
  const zp = path.join(ctx.userDataRoot, "pack.zip");
  fs.writeFileSync(zp, zip.toBuffer());
  return importThemePack(zp);
}

test("hexToRgb / normalizeAccent 纯函数契约", () => {
  assert.deepEqual(hexToRgb("#FFAA66"), [255, 170, 102]);
  assert.deepEqual(hexToRgb("#ffaa66"), [255, 170, 102]);
  assert.equal(hexToRgb("#ffa66"), null);       // 3 位不支持
  assert.equal(hexToRgb("rgb(1,2,3)"), null);   // 非 hex 原样返回 null（dsVarsCss 会透传字符串）
  const dark = normalizeAccent([10, 10, 10]);
  const lum = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000;
  assert.ok(lum(dark) >= 130);                  // 暗色提亮到可读
  assert.deepEqual(normalizeAccent([255, 170, 102]), [255, 170, 102]); // 亮色不动
});

test("导入主题包：token 映射、背景图落盘、focusX → 位置", () => {
  config.loadConfig();
  const t = loadPack(makePackZip());
  assert.equal(t.name, "Pack");
  assert.equal(t.packId, "pack-x");
  assert.equal(t.packVersion, "2.5");
  assert.equal(t.position, "left"); // focusX 0.2 < 0.4
  assert.deepEqual(t.accent, [255, 170, 102]);
  assert.deepEqual(t.dsColors, THEME_META.colors);
  assert.ok(t.dsCss.includes('data-ds-part="root"'));
  const bgDir = config.getBgDir();
  assert.ok(t.file.startsWith(bgDir + path.sep));
  assert.ok(fs.existsSync(t.file));
  assert.equal(t.thumb, null); // fake nativeImage 返回空图 → 缩略图走回退
});

test("一级子目录中的 theme.json 可定位；focusX 三档位置映射", () => {
  config.loadConfig();
  const t = loadPack(makePackZip({ dirPrefix: "sub/", meta: { ...THEME_META, art: { focusX: 0.8 } } }));
  assert.equal(t.name, "Pack");
  assert.equal(t.position, "right");
  const t2 = loadPack(makePackZip({ meta: { ...THEME_META, art: { focusX: 0.5 } } }));
  assert.equal(t2.position, "center");
});

test("非法包逐项拒绝", () => {
  config.loadConfig();
  assert.throws(() => loadPack(makePackZip({ withTheme: false, withCss: false, withImage: false })), /包内没有 theme\.json/);
  const AdmZip = require("adm-zip");
  const badJson = new AdmZip();
  badJson.addFile("theme.json", Buffer.from("not json"));
  assert.throws(() => loadPack(badJson), /theme\.json 解析失败/);
  assert.throws(() => loadPack(makePackZip({ meta: { name: "N" } })), /缺少 image 字段/);
  assert.throws(() => loadPack(makePackZip({ meta: { ...THEME_META, image: "../evil.png" } })), /背景图路径非法/);
  assert.throws(() => loadPack(makePackZip({ meta: { ...THEME_META, image: "evil.sh" } })), /背景图路径非法/);
  assert.throws(() => loadPack(makePackZip({ meta: { ...THEME_META, image: "missing.png" } })), /包内找不到背景图 missing\.png/);
});

test("启动回填：按 packId 从扫描目录补齐 dsColors/dsCss/packVersion 并落盘", () => {
  const root = freshRoot();
  ctx.userDataRoot = root;
  const packDir = path.join(root, "packs");
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, "pack-x.zip"), makePackZip().toBuffer());
  process.env.USERPROFILE = root;            // 避免扫到真实 Downloads
  process.env.ZCODE_THEME_DIRS = packDir;
  try {
    config.loadConfig();
    config.get().themes.push({ id: "t1", name: "P", packId: "pack-x" });
    backfillPackThemes();
    const t = config.get().themes[0];
    assert.equal(t.packVersion, "2.5");
    assert.equal(t.dsColors.accent, "#FFAA66");
    assert.ok(t.dsCss.includes('data-ds-part="root"'));
    const persisted = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
    assert.equal(persisted.themes[0].packVersion, "2.5");
  } finally {
    delete process.env.ZCODE_THEME_DIRS;
    delete process.env.USERPROFILE;
  }
});
