/* 社区主题 IPC：按 ver_ ID 下载导入；打开主题库（URL 在主进程硬编码，白名单天然成立） */
const { ipcMain, shell } = require("electron");
const config = require("../config");
const { log } = require("../log");
const { installCommunityPack, GALLERY_URL } = require("../community");

function register() {
  ipcMain.handle("community-install", async (event, payload) => {
    const ref = payload && typeof payload.ref === "string" ? payload.ref : "";
    // 阶段进度实时推给渲染层（窗口可能中途隐藏，销毁判断兜底）
    const send = p => { try { if (!event.sender.isDestroyed()) event.sender.send("community-progress", p); } catch {} };
    try {
      const { theme } = await installCommunityPack(ref, send);
      config.get().themes.unshift(theme);
      if (!config.get().draftId) config.get().draftId = theme.id;
      config.saveConfig();
      // 与本地导入一致：主题库变化后刷新托盘"切换主题"子菜单
      const { state } = require("../state");
      if (state.trayRebuild) { try { state.trayRebuild(); } catch {} }
      return { ok: true, state: config.publicState(), theme: { id: theme.id, name: theme.name } };
    } catch (e) {
      log("community", "社区主题导入失败: " + e.message);
      return { ok: false, message: e.message };
    }
  });

  ipcMain.handle("open-community-gallery", async () => {
    try { await shell.openExternal(GALLERY_URL); return { ok: true }; }
    catch (e) {
      log("community", "打开主题库失败: " + e.message);
      return { ok: false, message: e.message };
    }
  });
}

module.exports = { register };
