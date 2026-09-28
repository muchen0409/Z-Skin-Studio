/* ZCode 版本相关 IPC：版本读取 / 更新检查 / 路径选择 / 日志目录 */
const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, dialog, shell, app } = require("electron");
const config = require("../config");
const { log } = require("../log");
const zcode = require("../zcode");

function register() {
  ipcMain.handle("get-zcode-version", () => {
    const info = zcode.getZcodeInfo();
    if (!info) return { version: null, exe: null, message: "未找到 ZCode.exe" };
    try {
      const version = zcode.readAsarPackageVersion(path.join(path.dirname(info.exe), "resources", "app.asar"));
      return { version, exe: info.exe, message: version ? null : "asar 内没有版本信息" };
    } catch (e) {
      return { version: null, exe: info.exe, message: "读取失败: " + e.message };
    }
  });

  ipcMain.handle("check-zcode-update", async () => {
    try {
      return await zcode.checkZcodeUpdate();
    } catch (e) {
      log("update", "检查更新异常: " + e.message);
      return { ok: false, message: "检查更新异常：" + e.message };
    }
  });

  ipcMain.handle("choose-zcode", async () => {
    const r = await dialog.showOpenDialog(require("../state").state.win, {
      title: "选择 ZCode.exe",
      filters: [{ name: "ZCode.exe", extensions: ["exe"] }],
      properties: ["openFile"],
    });
    if (!r.canceled && r.filePaths[0]) { config.get().zcodeExe = r.filePaths[0]; config.saveConfig(); }
    return config.publicState();
  });

  ipcMain.handle("open-logs", async () => {
    const dir = app.getPath("userData");
    const r = await shell.openPath(dir);
    if (r) log("logs", "打开日志目录失败: " + r);
    return { ok: !r, message: r || undefined };
  });
}

module.exports = { register };
