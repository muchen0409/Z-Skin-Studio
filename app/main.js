/* Zcode+ 管理控制台 — Electron 主进程：GPU 开关 / 单实例 / 窗口 / 托盘 / 生命周期 */
const { app, BrowserWindow, Tray, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { state } = require("./src/state");
const { initLog, log } = require("./src/log");
const config = require("./src/config");

/* GPU 开关：默认不禁用硬件加速；部分机器 GPU 合成会黑屏，在 app 目录放 gpu-off.flag
   （或启动参数 --disable-gpu）即回到软件渲染。该调用必须发生在 app ready 前 */
state.gpuOff = fs.existsSync(path.join(__dirname, "gpu-off.flag")) || process.argv.includes("--disable-gpu");
if (state.gpuOff) app.disableHardwareAcceleration();

/* 单实例锁：防止多个实例并发读写同一份 config.json 互相覆盖 */
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  // C7：已驻留时再次带 CLI 参数启动，由驻留实例接管执行（窗口顺带唤出）
  app.on("second-instance", (_e, argv) => {
    log("app", "second-instance fired, win=" + !!state.win);
    if (state.win) { if (state.win.isMinimized()) state.win.restore(); state.win.show(); state.win.focus(); }
    require("./src/cli").handleIfRequested(argv).catch(e => log("cli", "CLI 执行失败: " + e.message));
  });
}

function createWindow() {
  state.win = new BrowserWindow({
    width: 1040,
    height: 720,
    autoHideMenuBar: true,
    backgroundColor: "#141210",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  state.win.loadFile(path.join(__dirname, "ui", "index.html"));
  // C1：--hidden（开机自启路径）时不弹窗口，驻留托盘
  state.win.once("ready-to-show", () => { if (!process.argv.includes("--hidden")) state.win.show(); });
  // 关窗 = 隐藏到托盘，程序驻留（托盘菜单可真正退出）
  state.win.on("close", e => {
    if (!app.isQuitting) {
      e.preventDefault();
      state.win.hide();
    }
  });
}

/* C2 托盘菜单：含主题快捷切换子菜单；主题增删/改名/切换后调用 rebuildTrayMenu 刷新 */
function buildThemeSubmenu() {
  const cfg = config.get();
  const items = cfg.themes.slice(0, 15).map(t => ({
    label: (t.id === cfg.appliedId ? "✓ " : "") + t.name,
    click: () => { applyThemeById(t.id); },
  }));
  return items.length ? items : [{ label: "（还没有主题）", enabled: false }];
}

async function applyThemeById(id) {
  const cfg = config.get();
  const t = cfg.themes.find(x => x.id === id);
  if (!t) return;
  try {
    if (state.skinSession && state.skinSession.ws.readyState === 1) {
      const r = await require("./src/skin").switchSkinTheme(t);
      if (state.tray) state.tray.setToolTip("Zcode+ — " + (r.ok ? `已切换到「${t.name}」` : r.message));
      rebuildTrayMenu();
    } else {
      cfg.draftId = id; config.saveConfig();
      const r = await require("./src/ipc/runtime").enableSkinViaIpc();
      if (state.tray) state.tray.setToolTip("Zcode+ — " + r.message);
    }
  } catch (e) {
    log("tray", "切换主题失败: " + e.message);
  }
}

function rebuildTrayMenu() {
  if (!state.tray) return;
  try {
    state.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "显示主窗口", click: () => { if (state.win) { state.win.show(); state.win.focus(); } } },
      { label: "切换主题", submenu: buildThemeSubmenu() },
      { type: "separator" },
      { label: "应用皮肤", click: async () => {
          if (state.trayApply) { const r = await state.trayApply(); state.tray.setToolTip("Zcode+ — " + r.message); }
        } },
      { label: "恢复外观", click: async () => {
          if (state.trayRestore) { const r = await state.trayRestore(); state.tray.setToolTip("Zcode+ — " + r.message); }
        } },
      { type: "separator" },
      { label: "退出", click: () => { app.isQuitting = true; app.quit(); } },
    ]));
  } catch (e) {
    log("tray", "托盘菜单重建失败: " + e.message);
  }
}

function createTray() {
  try {
    state.tray = new Tray(path.join(__dirname, "tray.png"));
  } catch {
    return; // 图标缺失不影响主功能
  }
  state.tray.setToolTip("Zcode+ 管理控制台");
  state.trayRebuild = rebuildTrayMenu;
  rebuildTrayMenu();
  state.tray.on("double-click", () => { if (state.win) { state.win.show(); state.win.focus(); } });
}

if (gotSingleLock) app.whenReady().then(async () => {
  initLog(app.getPath("userData"));
  config.loadConfig();
  // C1：把已保存的自启偏好同步到系统登录项（打包版才生效；开发模式仅记录）
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: config.get().autostart, path: process.execPath, args: ["--hidden"] });
    }
  } catch (e) { log("autostart", "登录项设置失败: " + e.message); }
  // C7：命令行模式（--apply/--restore/--status）不弹窗口，执行完退出
  const cliArgs = require("./src/cli").parseCliArgs(process.argv);
  if (cliArgs.command) {
    try { await require("./src/cli").handleCliArgs(cliArgs); }
    catch (e) { log("cli", "CLI 执行失败: " + e.message); }
    app.quit();
    return;
  }
  // IPC 注册（runtime 依赖注入 launchZcode，避免模块反向依赖入口文件）
  const runtime = require("./src/ipc/runtime");
  runtime.register({ launchZcode });
  require("./src/ipc/themes").register();
  require("./src/ipc/community").register();
  require("./src/ipc/version").register();
  require("./src/ipc/export").register();
  createWindow();
  createTray();
  require("./src/rotation").startRotationTimer();
  require("./src/hotkeys").applyHotkeys();
  // C5：系统深浅色变化时，「跟随系统」模式下重注入外观偏好与皮肤
  try {
    const { nativeTheme } = require("electron");
    nativeTheme.on("updated", () => {
      try {
        if (config.get().appearance === "system" && state.skinSession) require("./src/skin").reapplySkin();
      } catch (e) { log("appearance", "系统深浅色联动失败: " + e.message); }
    });
  } catch (e) { log("appearance", "nativeTheme 监听失败: " + e.message); }
  // 主题包回填与缩略图/accent 补齐：窗口显示之后异步执行，不阻塞首屏
  setImmediate(() => {
    const packs = require("./src/theme-pack");
    try { packs.backfillPackThemes(); } catch (e) { log("backfill", "主题包回填失败: " + e.message); }
    try { packs.ensureThumbsAndAccents(); } catch (e) { log("backfill", "素材回填失败: " + e.message); }
    // C1：自动接管——由本启动器拉起 ZCode 并注入上次主题（仅当上次会话正常结束时启用过）
    const cfg = config.get();
    if (cfg.autoApply && cfg.appliedId) {
      setTimeout(() => {
        runtime.enableSkinViaIpc(cfg.appliedId)
          .then(r => log("autoapply", "自动应用: " + (r.message || "")))
          .catch(e => log("autoapply", "自动应用异常: " + e.message));
      }, 3000);
    }
  });
  // 兜底：极罕见的异步异常（如进程启动竞态）不带走整个控制台
  process.on("uncaughtException", err => log("fatal", "未捕获异常: " + err.message));
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// 关窗只是隐藏到托盘，程序持续驻留；真正退出走托盘菜单（before-quit 置位）
app.on("before-quit", () => {
  app.isQuitting = true;
  try { require("./src/rotation").stopRotationTimer(); } catch {}
  try { require("./src/skin").teardownSession().catch(() => {}); } catch {}
});
app.on("window-all-closed", () => { /* 驻留托盘，不退出 */ });

/* 拉起 ZCode（带调试端口）。
   exe 路径经环境变量传递而非拼进命令行文本，由 PowerShell Start-Process 独立启动
   （进程分离、无 shell 解析面）；启动器自身拿不到子进程 pid，探活由 zcode.js 的
   tasklist 结果缓存兜底。端口字面量须与 src/cdp.js 的 PORT 保持一致 */
function launchZcode(exePath) {
  const { spawn } = require("node:child_process");
  if (typeof exePath !== "string" || !/\.exe$/i.test(exePath) || !fs.existsSync(exePath)) {
    log("spawn", "拒绝启动非法路径: " + exePath);
    return false;
  }
  const child = spawn("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
    "Start-Process -FilePath $env:ZEXE -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=*'",
  ], {
    windowsHide: true,
    stdio: "ignore",
    shell: false,
    env: { ...process.env, ZEXE: exePath },
  });
  child.on("error", e => log("spawn", "ZCode 启动失败: " + e.message));
  child.unref();
  return true;
}
