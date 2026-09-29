/* 主题库导出：B1 单主题导出为 DreamSkin 兼容 zip 包、B2/D4 全库备份打包与恢复 */
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const config = require("./config");
const { log } = require("./log");

const MAX_BACKUP_ENTRY = 100 * 1024 * 1024; // 与主题包导入同款单文件上限
const BG_PREFIX = "backgrounds/";

function rgbToHex([r, g, b]) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

/* 包名仅保留文件系统安全字符 */
function sanitizePackName(name) {
  const s = String(name || "").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim().slice(0, 60);
  return s || "theme";
}

/* B1：把一个主题重建为 DreamSkin 兼容 zip（theme.json + theme.css? + 背景图）。
   包来源主题还原 dsColors/dsCss；本地图片主题从导入时缓存的 accent 生成 accent token，
   位置映射回 art.focusX（与 importThemePack 的 focusX 三档映射互逆）。
   不写 manifest.json：本工具导入不依赖它（theme-pack.js 视为可选）。 */
function buildPackZip(theme) {
  const t = theme;
  if (!t || !t.file || !fs.existsSync(t.file)) throw new Error("主题背景图缺失，无法导出");
  let ext = (path.extname(t.file) || ".jpg").toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  const imgName = "background" + ext;
  const colors = { ...(t.dsColors && typeof t.dsColors === "object" ? t.dsColors : {}) };
  colors.accent = Array.isArray(colors.accent)
    ? rgbToHex(colors.accent)
    : (typeof colors.accent === "string" ? colors.accent : rgbToHex(t.accent));
  const meta = {
    id: typeof t.packId === "string" && t.packId ? t.packId : t.id,
    name: t.name,
    packageVersion: String(t.packVersion || "1"),
    image: imgName,
    art: { focusX: t.position === "left" ? 0.3 : t.position === "right" ? 0.7 : 0.5 },
    colors,
  };
  const zip = new AdmZip();
  zip.addFile("theme.json", Buffer.from(JSON.stringify(meta, null, 2), "utf8"));
  if (typeof t.dsCss === "string" && t.dsCss) zip.addFile("theme.css", Buffer.from(t.dsCss, "utf8"));
  zip.addFile(imgName, fs.readFileSync(t.file));
  return { buffer: zip.toBuffer(), filename: sanitizePackName(t.name) + ".zip" };
}

/* B2：全库备份 = config.json + meta.json + backgrounds/ 逐文件镜像。
   thumb 一并打包（几 KB 级，省去恢复后的重新生成）。
   config 内的绝对路径不清洗——恢复端统一按 basename 重写到当次机器的 bgDir。 */
function buildBackupZip(cfg) {
  const bgDir = path.resolve(config.getBgDir());
  const zip = new AdmZip();
  zip.addFile("meta.json", Buffer.from(JSON.stringify({
    app: "zcode-skin-launcher", schema: 1,
    exportedAt: new Date().toISOString(),
    themes: (cfg.themes || []).length,
  }, null, 2), "utf8"));
  zip.addFile("config.json", Buffer.from(JSON.stringify(cfg, null, 2), "utf8"));
  const add = abs => {
    try {
      if (!abs || !fs.existsSync(abs)) return;
      const rel = path.relative(bgDir, abs);
      if (rel.startsWith("..")) return; // 越出 bgDir 的路径不打包
      zip.addFile(BG_PREFIX + rel.replace(/\\/g, "/"), fs.readFileSync(abs));
    } catch (e) { log("backup", "打包文件跳过 " + abs + ": " + e.message); }
  };
  for (const t of cfg.themes || []) { add(t.file); add(t.thumb); }
  return { buffer: zip.toBuffer(), filename: "zcodeplus-backup-" + stamp() + ".zip" };
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
}

/* 备份条目相对路径白名单校验（纯函数，供单测）：拒绝 ".." 段与空段。
   注：adm-zip 的 addFile 本身会净化 "../"，此处是针对手工构造字节流的纵深防御 */
function isSafeBgRel(rel) {
  return rel.length > 0 && !rel.split("/").some(seg => seg === ".." || seg === "");
}

/* B2/D4：从备份包整体恢复（替换当前主题库与配置）。
   安全面：zip 条目名视为不可信——逐条 resolve 到 bgDir 内并拒绝 ".." 段；
   恢复前把当前 config 留档 .pre-restore；恢复后 loadConfig 重读，
   缺失文件的主题会被既有校验过滤、失效的 appliedId/draftId 归零。 */
function restoreBackup(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const get = name => entries.find(e => e.entryName === name);

  const metaEntry = get("meta.json");
  if (!metaEntry) throw new Error("不是本工具导出的备份包（缺少 meta.json）");
  let meta;
  try { meta = JSON.parse(metaEntry.getData().toString("utf8")); }
  catch { throw new Error("备份包 meta.json 解析失败"); }
  if (meta.app !== "zcode-skin-launcher") throw new Error("备份包来源不符（app: " + meta.app + "）");

  const cfgEntry = get("config.json");
  if (!cfgEntry) throw new Error("备份包缺少 config.json");
  let newCfg;
  try { newCfg = JSON.parse(cfgEntry.getData().toString("utf8")); }
  catch { throw new Error("备份包 config.json 解析失败"); }
  if (!newCfg || !Array.isArray(newCfg.themes)) throw new Error("备份包 config.json 结构异常");

  const bgDir = path.resolve(config.getBgDir());
  for (const e of entries) {
    if (!e.entryName.startsWith(BG_PREFIX)) continue;
    if (e.header.size > MAX_BACKUP_ENTRY) throw new Error("备份包含超大文件，已中止");
    const rel = e.entryName.slice(BG_PREFIX.length).replace(/\\/g, "/");
    if (!isSafeBgRel(rel)) throw new Error("备份包含越界路径，已中止");
    const target = path.resolve(bgDir, rel);
    if (!target.startsWith(bgDir + path.sep)) throw new Error("备份包含越界路径，已中止");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.getData());
  }

  for (const t of newCfg.themes) {
    if (typeof t.file === "string" && t.file) t.file = path.join(bgDir, path.basename(t.file));
    if (typeof t.thumb === "string" && t.thumb) t.thumb = path.join(bgDir, "thumbs", path.basename(t.thumb));
  }

  const cfgFile = config.getConfigFile();
  try { if (fs.existsSync(cfgFile)) fs.copyFileSync(cfgFile, cfgFile + ".pre-restore"); } catch {}
  fs.writeFileSync(cfgFile, JSON.stringify(newCfg, null, 2));
  config.loadConfig(); // 重读 + 旧结构迁移 + 文件存在性过滤
  log("backup", `已从备份恢复（${newCfg.themes.length} 个主题，导出于 ${meta.exportedAt || "未知时间"}）`);
  return config.publicState();
}

module.exports = { rgbToHex, sanitizePackName, buildPackZip, buildBackupZip, restoreBackup, isSafeBgRel };
