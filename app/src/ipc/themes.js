/* 主题库 IPC：导入 / 重命名 / 删除 / 草稿 / 参数 */
const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, dialog } = require("electron");
const config = require("../config");
const { log } = require("../log");
const { importThemePack, importImageFile, themeAccent, normalizeAccent, extractAccent, POSITIONS } = require("../theme-pack");

/* 主题库变化后刷新托盘"切换主题"子菜单 */
function refreshTray() {
  const { state } = require("../state");
  if (state.trayRebuild) { try { state.trayRebuild(); } catch {} }
}

/* 调参重注入防抖：拖动滑块会连续触发，300ms 内合并为一次 */
let livePreviewTimer = null;
function scheduleLivePreview(t) {
  if (livePreviewTimer) clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(() => {
    livePreviewTimer = null;
    require("../skin").previewTheme(t).then(r => {
      if (r && !r.ok && r.message !== "皮肤未启用") log("preview", "调参重注入失败: " + r.message);
    }).catch(() => {});
  }, 300);
}

function register() {
  ipcMain.handle("get-state", () => config.publicState());

  ipcMain.handle("import-themes", async () => {
    const r = await dialog.showOpenDialog(require("../state").state.win, {
      title: "导入主题（图片或 DreamSkin 主题包）",
      filters: [
        { name: "主题 / 图片", extensions: ["jpg", "jpeg", "jfif", "jpe", "png", "webp", "avif", "bmp", "gif", "zip"] },
      ],
      properties: ["openFile", "multiSelections"],
    });
    if (r.canceled) return config.publicState();
    const imported = [];
    for (const src of r.filePaths) {
      if (/\.zip$/i.test(src)) {
        try {
          const t = importThemePack(src);
          config.get().themes.unshift(t);
          imported.push(`主题包「${t.name}」`);
        } catch (e) {
          imported.push(`包 ${path.basename(src)} 导入失败：${e.message}`);
          log("import", "主题包导入失败 " + path.basename(src) + ": " + e.message);
        }
        continue;
      }
      try {
        const t = importImageFile(src);
        config.get().themes.unshift(t);
        imported.push(t.name);
      } catch (e) {
        imported.push(`图片 ${path.basename(src)} 导入失败：${e.message}`);
        log("import", "图片导入失败 " + path.basename(src) + ": " + e.message);
      }
    }
    if (!config.get().draftId) config.get().draftId = config.get().themes[0]?.id || null;
    config.saveConfig();
    refreshTray();
    return { ...config.publicState(), imported };
  });

  ipcMain.handle("rename-theme", (_e, payload) => {
    const id = payload && payload.id;
    const name = String((payload && payload.name) || "").trim();
    const t = config.get().themes.find(x => x.id === id);
    if (t && name) { t.name = name.slice(0, 40); config.saveConfig(); refreshTray(); }
    return config.publicState();
  });

  ipcMain.handle("remove-theme", (_e, id) => {
    const t = config.get().themes.find(x => x.id === id);
    if (t) {
      try { fs.unlinkSync(t.file); } catch {}
      if (t.thumb) { try { fs.unlinkSync(t.thumb); } catch {} }
      config.get().themes = config.get().themes.filter(x => x.id !== id);
      if (config.get().draftId === id) config.get().draftId = config.get().themes[0]?.id || null;
      if (config.get().appliedId === id) config.get().appliedId = null;
      config.saveConfig();
      refreshTray();
    }
    return config.publicState();
  });

  /* A4：选卡片即载入草稿；皮肤已启用时同时热切换出实时预览（不写 appliedId，
     ZCode 重启或点"恢复"后即消失，点「应用主题」才落盘保存） */
  ipcMain.handle("set-draft", async (_e, id) => {
    const t = config.get().themes.find(x => x.id === id);
    if (t && config.get().themes.some(x => x.id === id)) {
      config.get().draftId = id; config.saveConfig();
      let previewed = false;
      try {
        const pr = await require("../skin").previewTheme(t);
        previewed = !!(pr && pr.ok);
        if (pr && !pr.ok && pr.message !== "皮肤未启用") log("preview", "预览失败: " + pr.message);
      } catch (e) { log("preview", "预览异常: " + e.message); }
      return { ...config.publicState(), accent: themeAccent(t), previewed };
    }
    return { ...config.publicState(), accent: themeAccent(config.get().themes.find(x => x.id === id)) };
  });

  ipcMain.handle("set-theme-params", (_e, payload) => {
    const id = payload && payload.id;
    const alpha = payload && payload.alpha;
    const position = payload && payload.position;
    const t = config.get().themes.find(x => x.id === id);
    if (t) {
      if (typeof alpha === "number") t.alpha = Math.min(0.9, Math.max(0.02, alpha));
      if (position in POSITIONS) t.position = position;
      // A1 滤镜 / A2 遮罩：兼容两种 payload 形态——扁平键（preload 展开后 {blur:8}）与嵌套 {filter:{blur:8}}
      const fPatch = payload.filter && typeof payload.filter === "object" ? payload.filter : payload;
      const f = t.filter;
      if (typeof fPatch.blur === "number") f.blur = Math.min(20, Math.max(0, fPatch.blur));
      if (typeof fPatch.brightness === "number") f.brightness = Math.min(1.5, Math.max(0.5, fPatch.brightness));
      if (typeof fPatch.contrast === "number") f.contrast = Math.min(1.5, Math.max(0.5, fPatch.contrast));
      if (typeof fPatch.saturate === "number") f.saturate = Math.min(2, Math.max(0, fPatch.saturate));
      if ([0, 1, 2].includes(payload.shade)) t.shade = payload.shade;
      config.saveConfig();
      // 调参即时生效：会话中的主题若就是本主题（预览态或已应用），防抖后重新注入新参数
      const { state } = require("../state");
      const sess = state.skinSession;
      if (sess && sess.theme && sess.theme.id === t.id) scheduleLivePreview(t);
    }
    return config.publicState();
  });

  /* 取色兜底：缓存意外缺失（如手工改配置）时现算一次并落盘，之后不再解码 */
  ipcMain.handle("get-accent", (_e, id) => {
    const t = config.get().themes.find(x => x.id === id);
    if (t && !t.accent) {
      t.accent = normalizeAccent(extractAccent(t.file));
      config.saveConfig();
    }
    return themeAccent(t);
  });
}

module.exports = { register };
