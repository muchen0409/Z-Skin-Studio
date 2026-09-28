/* 配置：加载、旧结构迁移、校验、原子写 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { log } = require("./log");

/* ZCode.exe 探测候选：环境变量优先，其余为常见安装位置；
   找不到时用户可在界面「更改 ZCode 路径」手动指定（存入 config） */
const EXE_CANDIDATES = [
  process.env.ZCODE_EXE || "",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "ZCode.exe"),
  path.join("C:", "Program Files", "ZCode", "ZCode.exe"),
].filter(Boolean);

let bgDir;      // 主题图片存储目录
let configFile; // 配置文件
let config;     // { themes:[...], draftId, appliedId, zcodeExe, appearance, rotation }

function getBgDir() { return bgDir; }
function get() { return config; }

function findZcodeExe() {
  for (const p of EXE_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch {} }
  return "";
}

/* 原子写：tmp + rename，写一半崩溃不会损坏 config.json；
   保留一份上次成功内容的 .bak，配合加载端的 .bak 恢复实现自愈 */
function saveConfig() {
  try {
    try { if (fs.existsSync(configFile)) fs.copyFileSync(configFile, configFile + ".bak"); } catch {}
    const tmp = configFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, configFile);
  } catch (e) {
    log("config", "原子写失败，回退直接写入: " + e.message);
    try { fs.writeFileSync(configFile, JSON.stringify(config, null, 2)); } catch (e2) {
      log("config", "配置写入彻底失败: " + e2.message);
    }
  }
}

function loadConfig() {
  bgDir = path.join(app.getPath("userData"), "backgrounds");
  configFile = path.join(app.getPath("userData"), "config.json");
  fs.mkdirSync(bgDir, { recursive: true });
  try {
    config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {
    // 主文件损坏：优先尝试 .bak 自愈，仍失败则留档损坏文件后重建
    config = null;
    try { config = JSON.parse(fs.readFileSync(configFile + ".bak", "utf8")); log("config", "主配置损坏，已从 .bak 恢复"); } catch {}
    if (!config) {
      try { fs.copyFileSync(configFile, configFile + ".bak-" + Date.now()); } catch {}
      config = {};
      log("config", "配置解析失败，已重建（损坏文件留档）");
    }
  }

  // 旧结构迁移：backgrounds + selectedId + panelAlpha → themes + draftId + 每主题参数
  if (!Array.isArray(config.themes)) {
    config.themes = (config.backgrounds || []).map(b => ({
      id: b.id, name: b.name, file: b.file,
      alpha: typeof config.panelAlpha === "number" ? config.panelAlpha : 0.10,
      position: "center",
    }));
    config.draftId = config.selectedId || config.themes[0]?.id || null;
    config.appliedId = null;
    delete config.backgrounds; delete config.selectedId; delete config.panelAlpha;
  }
  config.themes = config.themes.filter(t => { try { return fs.existsSync(t.file); } catch { return false; } });
  for (const t of config.themes) {
    if (typeof t.alpha !== "number") t.alpha = 0.10;
    if (!t.position) t.position = "center";
    // 背景滤镜与可读性遮罩（A1/A2）
    if (!t.filter || typeof t.filter !== "object") t.filter = {};
    const f = t.filter;
    if (typeof f.blur !== "number") f.blur = 0;
    if (typeof f.brightness !== "number") f.brightness = 1;
    if (typeof f.contrast !== "number") f.contrast = 1;
    if (typeof f.saturate !== "number") f.saturate = 1;
    if (![0, 1, 2].includes(t.shade)) t.shade = 0;
  }
  if (!config.themes.some(t => t.id === config.draftId)) config.draftId = config.themes[0]?.id || null;
  if (!config.themes.some(t => t.id === config.appliedId)) config.appliedId = null;
  if (!["follow", "zai-dark", "zai-light"].includes(config.appearance)) config.appearance = "follow";
  // 主题轮换配置
  if (!config.rotation || typeof config.rotation !== "object") config.rotation = {};
  const rot = config.rotation;
  if (typeof rot.enabled !== "boolean") rot.enabled = false;
  if (![1, 5, 30, 60, 180, 1440].includes(rot.intervalMin)) rot.intervalMin = 60;
  if (!["sequential", "random"].includes(rot.order)) rot.order = "sequential";
  if (typeof rot.index !== "number") rot.index = 0;
  if (!config.zcodeExe) config.zcodeExe = findZcodeExe() || "";
  // 运行偏好（C1 开机自启与自动应用 / C3 全局快捷键）
  if (typeof config.autoApply !== "boolean") config.autoApply = false;
  if (typeof config.autostart !== "boolean") config.autostart = false;
  if (!config.hotkeys || typeof config.hotkeys !== "object") config.hotkeys = {};
  if (typeof config.hotkeys.enabled !== "boolean") config.hotkeys.enabled = true;
  // D2 选择器健康快照（诊断时写入）：{ checkedAt, zcodeVersion, hits, zeroCore }
  if (!config.selectorStats || typeof config.selectorStats !== "object") config.selectorStats = null;
  saveConfig();
}

function publicState() {
  return {
    themes: config.themes,
    draftId: config.draftId,
    appliedId: config.appliedId,
    zcodeExe: config.zcodeExe || "",
    appearance: config.appearance || "follow",
    rotation: config.rotation,
    autoApply: !!config.autoApply,
    autostart: !!config.autostart,
    hotkeys: config.hotkeys || { enabled: true },
    appVersion: app.getVersion(),
    gpuOff: require("./state").state.gpuOff,
  };
}

module.exports = { loadConfig, saveConfig, findZcodeExe, publicState, get, getBgDir };
