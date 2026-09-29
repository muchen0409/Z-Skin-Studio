/* 主题素材：图片取色、缩略图、DreamSkin 主题包解析、启动回填 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { nativeImage } = require("electron");
const AdmZip = require("adm-zip");
const config = require("./config");
const { log } = require("./log");

const IMG_EXT = /\.(jpe?g|jfif|png|webp|avif|bmp|gif)$/i;
const FALLBACK_ACCENT = [232, 168, 102]; // 琥珀（取色失败时回退）
const POSITIONS = { left: "left center", center: "center", right: "right center" };

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.test(hex) && hex;
  if (!m) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* 暗色取色结果提亮到可读亮度，避免强调色看不见 */
function normalizeAccent([r, g, b]) {
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  if (lum >= 130) return [r, g, b];
  const f = (170 - lum) / Math.max(lum, 1);
  return [
    Math.min(255, Math.round(r + 255 * f * 0.45 + 40)),
    Math.min(255, Math.round(g + 255 * f * 0.45 + 30)),
    Math.min(255, Math.round(b + 255 * f * 0.45 + 20)),
  ];
}

function boostSaturation([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0) return FALLBACK_ACCENT;
  const f = Math.min(1.6, 200 / max);
  return [
    Math.min(255, Math.round(min + (max - min) * 1.5 * f + (r - min) * f * 0.4)),
    Math.min(255, Math.round(min + (g - min) * 1.5 * f)),
    Math.min(255, Math.round(min + (b - min) * 1.5 * f)),
  ];
}

/* 动态取色：图片主色调 → 强调色。只在导入/回填时调用一次并落盘缓存，
   运行期一律走 themeAccent 的缓存路径，不再反复解码大图 */
function extractAccent(imageFile) {
  try {
    const img = nativeImage.createFromPath(imageFile);
    if (img.isEmpty()) return FALLBACK_ACCENT;
    const small = img.resize({ width: 24, height: 24 });
    const buf = small.getBitmap();
    let best = null, bestScore = -1;
    let sumR = 0, sumG = 0, sumB = 0, sumN = 0;
    for (let i = 0; i + 2 < buf.length; i += 4) {
      // Windows 下 nativeImage 位图为 BGRA 字节序，红蓝通道需交换
      const swap = process.platform === "win32";
      const r = swap ? buf[i + 2] : buf[i];
      const b = swap ? buf[i] : buf[i + 2];
      const g = buf[i + 1];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;   // 饱和度
      const lum = (r * 299 + g * 587 + b * 114) / 1000; // 亮度
      sumR += r; sumG += g; sumB += b; sumN++;
      // 挑鲜艳、亮度居中的像素作为主色
      const score = sat * 2 - Math.abs(lum - 128) / 128;
      if (score > bestScore) { bestScore = score; best = [r, g, b]; }
    }
    if (!best || bestScore < 0.35) {
      // 图片整体灰淡 → 用全图平均色提饱和
      const avg = [sumR / sumN, sumG / sumN, sumB / sumN];
      return boostSaturation(avg);
    }
    return best;
  } catch (e) {
    log("accent", "取色失败 " + path.basename(String(imageFile || "")) + ": " + e.message);
    return FALLBACK_ACCENT;
  }
}

function themeAccent(t) {
  if (t && t.accent) return normalizeAccent(t.accent); // 主题包 token / 导入时缓存的取色结果优先
  return t ? normalizeAccent(extractAccent(t.file)) : FALLBACK_ACCENT;
}

/* 生成 360px 宽 JPEG 缩略图，写入 backgrounds/thumbs/<id>.jpg */
function makeThumb(srcFile, id) {
  try {
    const img = nativeImage.createFromPath(srcFile);
    if (img.isEmpty()) return null;
    const thumbDir = path.join(config.getBgDir(), "thumbs");
    fs.mkdirSync(thumbDir, { recursive: true });
    const dest = path.join(thumbDir, id + ".jpg");
    fs.writeFileSync(dest, img.resize({ width: 360 }).toJPEG(80));
    return dest;
  } catch (e) {
    log("thumb", "缩略图生成失败 " + path.basename(String(srcFile || "")) + ": " + e.message);
    return null;
  }
}

/* ---------------- DreamSkin 主题包解析 ---------------- */
/* 包结构：manifest.json(可选) + theme.json(背景图/token) + theme.css(受控CSS) */
function importThemePack(zipPath) {
  // 超大包全量载内存会卡主进程，设上限
  if (fs.statSync(zipPath).size > 100 * 1024 * 1024) throw new Error("主题包超过 100MB 上限");
  const zip = new AdmZip(zipPath);
  const packName = path.basename(zipPath, path.extname(zipPath));

  // 在 zip 内定位 theme.json（允许位于一级子目录；容忍 Windows 反斜杠路径）
  const norm = p => String(p).replace(/\\/g, "/");
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const themeEntry = entries.find(e => norm(e.entryName) === "theme.json")
    || entries.find(e => norm(e.entryName).endsWith("/theme.json"));
  if (!themeEntry) throw new Error("包内没有 theme.json，不是支持的主题包格式");
  const dirPrefix = themeEntry.entryName.slice(0, -"theme.json".length);

  let meta;
  try { meta = JSON.parse(themeEntry.getData().toString("utf8")); }
  catch { throw new Error("theme.json 解析失败"); }
  if (!meta || !meta.image) throw new Error("theme.json 缺少 image 字段");

  // 背景图：仅允许图片扩展名，包内路径不得包含 ..
  if (typeof meta.image !== "string" || !IMG_EXT.test(meta.image) || meta.image.includes("..")) {
    throw new Error("包内背景图路径非法");
  }
  const imgEntry = entries.find(e => e.entryName === dirPrefix + meta.image);
  if (!imgEntry) throw new Error(`包内找不到背景图 ${meta.image}`);

  // 提取背景图字节到主题库（uuid 文件名 + 显式校验不越出主题库根目录）
  const root = path.resolve(config.getBgDir());
  const ext = meta.image.toLowerCase().match(IMG_EXT)[0].replace(".jpeg", ".jpg");
  const dest = path.resolve(root, crypto.randomUUID() + ext);
  if (!dest.startsWith(root + path.sep)) throw new Error("目标路径越出主题库目录");
  fs.writeFileSync(dest, imgEntry.getData());

  // 设计 token → 主题参数
  const accent = meta.colors && hexToRgb(meta.colors.accent);
  const focusX = meta.art && typeof meta.art.focusX === "number" ? meta.art.focusX : 0.5;
  const position = focusX < 0.4 ? "left" : focusX > 0.6 ? "right" : "center";

  const id = crypto.randomUUID();
  return {
    id,
    name: String(meta.name || packName).slice(0, 40),
    file: dest,
    thumb: makeThumb(dest, id),
    alpha: 0.10,
    position,
    accent: accent || normalizeAccent(extractAccent(dest)), // 包 token 优先，否则落一次取色缓存
    packId: typeof meta.id === "string" ? meta.id.slice(0, 40) : packName,
    packVersion: String(meta.packageVersion || meta.version || "1"),
    // DreamSkin 兼容层素材：颜色 token + 包内 theme.css（启用时映射到 ZCode DOM）
    dsColors: meta.colors && typeof meta.colors === "object" ? meta.colors : undefined,
    dsCss: (() => {
      const cssEntry = entries.find(e => norm(e.entryName) === dirPrefix + "theme.css");
      return cssEntry ? cssEntry.getData().toString("utf8") : undefined;
    })(),
  };
}

/* 导入本地图片主题 */
function importImageFile(src) {
  const id = crypto.randomUUID();
  const dest = path.join(config.getBgDir(), id + (path.extname(src) || ".jpg"));
  fs.copyFileSync(src, dest);
  return {
    id,
    name: path.basename(src, path.extname(src)),
    file: dest,
    thumb: makeThumb(dest, id),
    alpha: 0.10,
    position: "center",
    accent: normalizeAccent(extractAccent(dest)), // 导入时取色一次并落盘
  };
}

/* ---------------- 启动回填（窗口显示后异步执行，不阻塞首屏） ---------------- */
/* zip 解析缓存：同一 zip 可能对应多个主题，按 size+mtime 缓存 theme.json/css 解析结果 */
const zipScanCache = new Map();

function readPackFromZip(zp) {
  try {
    const st = fs.statSync(zp);
    const key = zp + "|" + st.size + "|" + st.mtimeMs;
    if (zipScanCache.has(key)) return zipScanCache.get(key);
    const zip = new AdmZip(zp);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const norm = n => String(n).replace(/\\/g, "/");
    const themeEntry = entries.find(e => norm(e.entryName) === "theme.json")
      || entries.find(e => norm(e.entryName).endsWith("/theme.json"));
    let pack = null;
    if (themeEntry) {
      const meta = JSON.parse(themeEntry.getData().toString("utf8"));
      const prefix = themeEntry.entryName.slice(0, -"theme.json".length);
      const cssEntry = entries.find(e => norm(e.entryName) === prefix + "theme.css");
      pack = {
        id: meta.id,
        version: String(meta.packageVersion || meta.version || "1"),
        colors: meta.colors && typeof meta.colors === "object" ? meta.colors : undefined,
        css: cssEntry ? cssEntry.getData().toString("utf8") : undefined,
      };
    }
    if (zipScanCache.size > 24) zipScanCache.clear();
    zipScanCache.set(key, pack);
    return pack;
  } catch (e) {
    log("backfill", "zip 解析失败 " + path.basename(zp) + ": " + e.message);
    return null;
  }
}

/* 早期导入的主题包可能只存了 accent；扫描常见下载目录里的 zip，
   按 packId 匹配补齐 dsColors/dsCss/packVersion（找不到就跳过，走自动取色） */
/* 扫描常见下载目录做回填；额外目录可用环境变量 ZCODE_THEME_DIRS（分号分隔）扩展 */
function backfillScanDirs() {
  const home = process.env.USERPROFILE || "";
  const dirs = [
    home && path.join(home, "Downloads", "QuarkDownloads"),
    home && path.join(home, "Downloads"),
    ...(process.env.ZCODE_THEME_DIRS || "").split(";").filter(Boolean),
  ].filter(Boolean);
  return dirs;
}

function backfillPackThemes() {
  const t0 = Date.now();
  const zips = [];
  for (const dir of backfillScanDirs()) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/\.zip$/i.test(f.name || f)) zips.push(path.join(dir, f.name || f));
      }
    } catch {}
  }
  if (!zips.length) return;
  let changed = false;
  for (const t of config.get().themes) {
    if (!t.packId) continue; // 本地图片主题没有包来源，跳过
    // 逐字段补齐（旧版本回填可能只补了部分字段）；packVersion 补齐后此条件即可短路
    if (t.dsCss && t.dsColors && t.packVersion) continue;
    for (const zp of zips) {
      if (Date.now() - t0 > 3000) { log("backfill", "3 秒软超时，剩余主题下次启动继续"); return; }
      const pack = readPackFromZip(zp);
      if (!pack || pack.id !== t.packId) continue;
      t.dsColors = pack.colors || undefined;
      t.dsCss = pack.css || undefined;
      // 与 importThemePack 同口径：回填真实包版本（此前硬编码 "1"，丢失了版本信息）
      t.packVersion = t.packVersion || pack.version || "1";
      changed = true;
      break;
    }
  }
  if (changed) {
    config.saveConfig();
    log("backfill", "主题包字段回填完成");
  }
}

/* 旧主题补缩略图 / 补 accent 缓存（后台一次性，之后不再重复解码） */
function ensureThumbsAndAccents() {
  let changed = false;
  for (const t of config.get().themes) {
    try {
      if (!t.thumb || !fs.existsSync(t.thumb)) {
        const th = makeThumb(t.file, t.id);
        if (th) { t.thumb = th; changed = true; }
      }
      if (!t.accent) {
        t.accent = normalizeAccent(extractAccent(t.file));
        changed = true;
      }
    } catch (e) { log("backfill", "回填失败 " + t.name + ": " + e.message); }
  }
  if (changed) config.saveConfig();
}

module.exports = {
  IMG_EXT, POSITIONS, FALLBACK_ACCENT,
  hexToRgb, normalizeAccent, extractAccent, themeAccent, makeThumb,
  importThemePack, importImageFile, backfillPackThemes, ensureThumbsAndAccents,
};
