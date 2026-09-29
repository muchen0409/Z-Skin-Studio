/* 导出/备份 IPC：B1 主题包导出、B2/D4 全库备份导出与恢复 */
const fs = require("node:fs");
const { ipcMain, dialog } = require("electron");
const config = require("../config");
const { state } = require("../state");
const { log } = require("../log");
const { buildPackZip, buildBackupZip, restoreBackup } = require("../export");

function register() {
  /* B1：单主题 → DreamSkin 兼容 zip */
  ipcMain.handle("export-theme", async (_e, id) => {
    const t = config.get().themes.find(x => x.id === id);
    if (!t) return { ok: false, message: "主题不存在或已删除。" };
    try {
      const { buffer, filename } = buildPackZip(t);
      const r = await dialog.showSaveDialog(state.win, {
        title: "导出主题包",
        defaultPath: filename,
        filters: [{ name: "DreamSkin 主题包", extensions: ["zip"] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, buffer);
      log("export", `主题包已导出「${t.name}」→ ${r.filePath}`);
      return { ok: true, path: r.filePath };
    } catch (e) {
      log("export", "主题包导出失败: " + e.message);
      return { ok: false, message: e.message };
    }
  });

  /* B2：全库备份 → 单个 zip */
  ipcMain.handle("backup-export", async () => {
    try {
      const { buffer, filename } = buildBackupZip(config.get());
      const r = await dialog.showSaveDialog(state.win, {
        title: "导出全库备份",
        defaultPath: filename,
        filters: [{ name: "Zcode+ 备份包", extensions: ["zip"] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(r.filePath, buffer);
      log("backup", "全库备份已导出 → " + r.filePath);
      return { ok: true, path: r.filePath };
    } catch (e) {
      log("backup", "备份导出失败: " + e.message);
      return { ok: false, message: e.message };
    }
  });

  /* D4：从备份包恢复（renderer 先 confirm；主进程留档 .pre-restore 兜底） */
  ipcMain.handle("backup-restore", async () => {
    try {
      const r = await dialog.showOpenDialog(state.win, {
        title: "选择备份包",
        filters: [{ name: "Zcode+ 备份包", extensions: ["zip"] }],
        properties: ["openFile"],
      });
      if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
      const pub = restoreBackup(r.filePaths[0]);
      return { ok: true, state: pub };
    } catch (e) {
      log("backup", "备份恢复失败: " + e.message);
      return { ok: false, message: e.message };
    }
  });
}

module.exports = { register };
