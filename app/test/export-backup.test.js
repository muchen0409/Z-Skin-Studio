/* B1/B2/D4：主题包导出（DreamSkin 兼容，round-trip 可再导入）、全库备份与恢复、恶意备份包拒绝 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { install, freshRoot } = require("./helpers/electron-mock");
const ctx = install();
const config = require("../src/config");
const { importThemePack } = require("../src/theme-pack");
const { rgbToHex, sanitizePackName, buildPackZip, buildBackupZip, restoreBackup, isSafeBgRel } = require("../src/export");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/* 测试内写文件统一走边界锚定的 resolveWithin（与 Mimosa 建议一致） */
function resolveWithin(root, ...segs) {
  const target = path.resolve(root, ...segs);
  if (!target.startsWith(root + path.sep)) throw new Error("测试路径越界: " + target);
  return target;
}

function makeTheme(over = {}) {
  const bgDir = path.resolve(config.getBgDir());
  const file = resolveWithin(bgDir, (over.fileId || "f1") + ".png");
  fs.writeFileSync(file, TINY_PNG);
  return {
    id: over.id || "t-" + (over.fileId || "f1"), name: over.name || "T", file,
    thumb: null, alpha: 0.1, position: over.position || "center", shade: 0,
    filter: { blur: 0, brightness: 1, contrast: 1, saturate: 1 },
    accent: over.accent || [255, 170, 102],
    ...over.fields,
  };
}

test("rgbToHex 与包名清洗", () => {
  assert.equal(rgbToHex([255, 170, 102]), "#ffaa66");
  assert.equal(rgbToHex([10, 10, 10]), "#0a0a0a");
  assert.equal(rgbToHex([300, -5, 1.4]), "#ff0001"); // 越界钳制 + 四舍五入
  assert.equal(sanitizePackName('a/b\\c:d*e?"<>|'), "a_b_c_d_e_"); // 连续非法字符合并为一个下划线
  assert.equal(sanitizePackName("   "), "theme");
  assert.equal(sanitizePackName(" Aurora "), "Aurora");
});

test("B1 round-trip：包来源主题导出后可再导入且 token 一致", () => {
  config.loadConfig();
  const t = makeTheme({
    name: "Aurora", position: "left", fileId: "pack1",
    fields: {
      packId: "pack-x", packVersion: "2.5",
      dsColors: { accent: "#FFAA66", background: "#112233", panel: "#334455", text: "#FFFFFF" },
      dsCss: '[data-ds-part="root"]{color:red}',
    },
  });
  config.get().themes.push(t);
  const { buffer, filename } = buildPackZip(t);
  assert.equal(filename, "Aurora.zip");

  const zp = resolveWithin(ctx.userDataRoot, "exported.zip");
  fs.writeFileSync(zp, buffer);
  const r = importThemePack(zp);
  assert.equal(r.name, "Aurora");
  assert.equal(r.packId, "pack-x");
  assert.equal(r.packVersion, "2.5");
  assert.equal(r.position, "left");                    // focusX 0.3 → left（映射互逆）
  assert.deepEqual(r.dsColors, t.dsColors);
  assert.equal(r.dsCss, t.dsCss);
  assert.deepEqual(r.accent, [255, 170, 102]);         // colors.accent "#FFAA66" 还原为 rgb
});

test("B1：本地图片主题从缓存 accent 生成 token；右位映射 focusX 0.7", () => {
  config.loadConfig();
  const t = makeTheme({ name: "Pic", position: "right", fileId: "pic1" });
  const { buffer } = buildPackZip(t);
  const AdmZip = require("adm-zip");
  const meta = JSON.parse(new AdmZip(buffer).readAsText("theme.json"));
  assert.equal(meta.colors.accent, "#ffaa66");
  assert.equal(meta.art.focusX, 0.7);
  assert.equal(meta.image, "background.png");
  assert.equal(new AdmZip(buffer).getEntry("theme.css"), null); // 无包样式则不产 theme.css

  const zp = resolveWithin(ctx.userDataRoot, "exported2.zip");
  fs.writeFileSync(zp, buffer);
  const r = importThemePack(zp);
  assert.equal(r.position, "right");
  assert.deepEqual(r.accent, [255, 170, 102]);
});

test("B1：背景图缺失的主题拒绝导出", () => {
  config.loadConfig();
  assert.throws(() => buildPackZip({ name: "X", file: "Z:\\nonexistent\\no.png" }), /背景图缺失/);
});

test("B2/D4 round-trip：跨目录恢复（模拟换机），路径重写到新 bgDir", () => {
  config.loadConfig();
  const rootA = ctx.userDataRoot;
  const t1 = makeTheme({ name: "Keep", fileId: "bk1" });
  t1.thumb = resolveWithin(path.resolve(config.getBgDir()), "thumbs", t1.id + ".jpg");
  fs.mkdirSync(path.dirname(t1.thumb), { recursive: true });
  fs.writeFileSync(t1.thumb, TINY_PNG);
  config.get().themes.push(t1);
  config.get().appearance = "zai-dark";

  const { buffer } = buildBackupZip(config.get());
  const backupPath = resolveWithin(rootA, "backup.zip");
  fs.writeFileSync(backupPath, buffer);

  // 切到全新 userData（模拟另一台机器 / 重装）
  ctx.userDataRoot = freshRoot();
  config.loadConfig();
  assert.deepEqual(config.get().themes, []); // 新目录从零开始

  const pub = restoreBackup(backupPath);
  assert.equal(pub.themes.length, 1);
  assert.equal(pub.themes[0].name, "Keep");
  assert.equal(pub.appearance, "zai-dark");
  assert.ok(pub.themes[0].file.startsWith(path.join(ctx.userDataRoot, "backgrounds") + path.sep));
  assert.ok(fs.existsSync(pub.themes[0].file));        // 背景图已随包迁移
  assert.ok(fs.existsSync(pub.themes[0].thumb));       // 缩略图同
  const persisted = JSON.parse(fs.readFileSync(resolveWithin(ctx.userDataRoot, "config.json"), "utf8"));
  assert.equal(persisted.themes[0].name, "Keep");
});

test("恢复前当前配置留档 .pre-restore", () => {
  const rootB = ctx.userDataRoot;
  const cfgPath = resolveWithin(rootB, "config.json");
  const before = fs.readFileSync(cfgPath, "utf8");

  // 再做一次备份并恢复，触发 .pre-restore 留档路径
  const { buffer } = buildBackupZip(config.get());
  const again = resolveWithin(rootB, "again.zip");
  fs.writeFileSync(again, buffer);
  restoreBackup(again);

  const preRestore = resolveWithin(rootB, "config.json.pre-restore");
  assert.ok(fs.existsSync(preRestore));
  assert.equal(fs.readFileSync(preRestore, "utf8"), before);
});

test("恶意/损坏备份包逐项拒绝", () => {
  config.loadConfig();
  const AdmZip = require("adm-zip");
  const mk = entries => {
    const z = new AdmZip();
    for (const [n, c] of entries) z.addFile(n, Buffer.from(c));
    return z;
  };
  const write = (name, zip) => {
    const f = resolveWithin(ctx.userDataRoot, name);
    fs.writeFileSync(f, zip.toBuffer());
    return f;
  };

  const noMeta = mk([["config.json", "{}"]]);
  assert.throws(() => restoreBackup(write("z1.zip", noMeta)), /不是本工具导出的备份包/);

  const wrongApp = mk([["meta.json", JSON.stringify({ app: "other" })], ["config.json", "{}"]]);
  assert.throws(() => restoreBackup(write("z2.zip", wrongApp)), /来源不符/);

  const noCfg = mk([["meta.json", JSON.stringify({ app: "zcode-skin-launcher" })]]);
  assert.throws(() => restoreBackup(write("z3.zip", noCfg)), /缺少 config\.json/);

  const badCfg = mk([
    ["meta.json", JSON.stringify({ app: "zcode-skin-launcher" })],
    ["config.json", JSON.stringify({ themes: "oops" })],
  ]);
  assert.throws(() => restoreBackup(write("z4.zip", badCfg)), /结构异常/);

  const traversal = mk([
    ["meta.json", JSON.stringify({ app: "zcode-skin-launcher" })],
    ["config.json", JSON.stringify({ themes: [] })],
    ["backgrounds/../../evil.txt", "pwned"],
  ]);
  // adm-zip 的 addFile 会把 "../" 净化掉（实测 entryName 变为 "evil.txt"），
  // 因此该 zip 要么被 isSafeBgRel 守卫拦截、要么条目安全落进 bgDir —— 无论哪条路，
  // evil.txt 都绝不允许出现在 bgDir 之外
  let outcome = "restored";
  try { restoreBackup(write("z5.zip", traversal)); }
  catch (e) { outcome = e.message; }
  assert.ok(outcome === "restored" || /越界路径/.test(outcome), "意外结果: " + outcome);
  assert.equal(fs.existsSync(path.join(path.resolve(ctx.userDataRoot), "evil.txt")), false);
});

test("isSafeBgRel：备份条目相对路径白名单（针对手工构造字节的纵深防御）", () => {
  assert.equal(isSafeBgRel("a.png"), true);
  assert.equal(isSafeBgRel("thumbs/a.jpg"), true);
  assert.equal(isSafeBgRel("../evil"), false);
  assert.equal(isSafeBgRel("a/../../evil"), false);
  assert.equal(isSafeBgRel(""), false);
  assert.equal(isSafeBgRel("a//b"), false);
});
