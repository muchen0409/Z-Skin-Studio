/* 运行时 IPC：状态探测 / 启用皮肤 / 恢复外观 / 深浅色 / 轮换设置 */
const fs = require("node:fs");
const { ipcMain } = require("electron");
const config = require("../config");
const { state, withBusy } = require("../state");
const { log } = require("../log");
const cdp = require("../cdp");
const zcode = require("../zcode");
const skin = require("../skin");

/* 状态探测：busy / idle / running-no-port / connected / skinned。
   稳态零开销：皮肤未启用时不新建 WebSocket 检查（仅 HTTP 层探测）；
   管理台重启后会话丢失的罕见场景才低频（15 秒）复检页面上是否仍有皮肤 */
let lastSkinnedCheck = 0;
let lastSkinnedResult = false;

async function probeStatus() {
  const s = state;
  if (s.opBusy) {
    // busy 卡死兜底：超过 60 秒自动复位（理论上 withBusy 已保证不泄漏）
    if (Date.now() - s.opBusySince > 60000) {
      log("busy", "opBusy 超过 60 秒未复位，自动解除");
      s.opBusy = false;
    } else {
      return { state: "busy" };
    }
  }
  const cfg = config.get();
  const reachable = await cdp.cdpReachable();
  if (!reachable) {
    // 端口不在才需要查进程，省一次 tasklist 开销
    if (await zcode.zcodeRunning()) return { state: "running-no-port", selectorHealth: healthOf() };
    return { state: "idle", selectorHealth: healthOf() };
  }
  const target = await cdp.pickTarget().catch(() => null);
  if (!target) return { state: "connected", selectorHealth: healthOf() };
  // 有活跃皮肤会话时直接复用，不再另开连接互踢
  if (s.skinSession && s.skinSession.ws.readyState === 1) {
    try {
      const skinned = await cdp.evaluate(s.skinSession.ws, `!!document.getElementById("zskin-style")`);
      return { state: skinned ? "skinned" : "connected", selectorHealth: healthOf() };
    } catch { return { state: "connected", selectorHealth: healthOf() }; }
  }
  if (!cfg.appliedId) return { state: "connected", selectorHealth: healthOf() };
  if (Date.now() - lastSkinnedCheck > 15000) {
    lastSkinnedCheck = Date.now();
    const ws = await cdp.connectWs(target.webSocketDebuggerUrl).catch(() => null);
    if (ws) {
      try {
        lastSkinnedResult = (await cdp.evaluate(ws, `!!document.getElementById("zskin-style")`)) === true;
      } catch { lastSkinnedResult = false; }
      finally { try { ws.close(); } catch {} }
    }
  }
  return { state: lastSkinnedResult ? "skinned" : "connected", selectorHealth: healthOf() };
}

/* D2 选择器健康：有快照且非 ok 时让 UI 提示（版本升级 = stale，核心选择器归零 = degraded） */
function healthOf() {
  try { return require("../diag").selectorHealth(); } catch { return null; }
}

/* 启用皮肤：托盘/IPC/开机自启共用入口。targetId 可指定主题（自动应用用上次主题），
   缺省用当前草稿。所有退出路径经 withBusy 收敛，杜绝 busy 泄漏 */
async function enableSkinViaIpc(targetId) {
  const cfg = config.get();
  const bg = cfg.themes.find(x => x.id === (targetId || cfg.draftId));
  if (!bg) return { ok: false, message: "请先导入并选择一个主题。" };

  const r = await withBusy(async () => {
    let reachable = await cdp.cdpReachable();
    if (!reachable) {
      if (await zcode.zcodeRunning()) {
        return { ok: false, message: "ZCode 正在运行，但未开启调试端口。请先完全退出 ZCode（含托盘图标），再点启动。" };
      }
      let exe = cfg.zcodeExe || config.findZcodeExe();
      if (!exe) return { ok: false, message: "未找到 ZCode.exe，请在设置中手动指定路径。" };
      // 启动前复核已记录路径仍存在（ZCode 可能已卸载/挪动），失效则回落自动探测
      if (!fs.existsSync(exe)) {
        const found = config.findZcodeExe();
        if (found) { cfg.zcodeExe = found; exe = found; }
        else return { ok: false, message: "已记录的 ZCode 路径不存在且未找到安装位置，请重新指定。" };
      }
      cfg.zcodeExe = exe; config.saveConfig();
      if (!launchZcode(exe)) {
        return { ok: false, message: "ZCode 启动失败：路径非法或文件不存在。" };
      }
      reachable = await cdp.waitCdp(45000);
      if (!reachable) {
        return { ok: false, message: "调试端口 9222 等待超时：该版本 ZCode 可能禁用了调试开关。" };
      }
    }

    try {
      const ir = await skin.injectSkinPersistent(bg);
      if (!ir.ok) return ir;
      cfg.appliedId = bg.id; config.saveConfig();
      return { ok: true, message: `已启用「${bg.name}」→ 窗口「${ir.title}」` };
    } catch (e) {
      log("enable", "注入失败: " + e.message);
      return { ok: false, message: e.message };
    }
  });
  return r.busy ? { ok: false, message: r.message } : r;
}

/* 恢复外观：托盘与 IPC 共用入口 */
async function restoreSkinViaIpc() {
  const r = await withBusy(async () => {
    try {
      await skin.teardownSession();
      if (!(await cdp.cdpReachable())) return { ok: true, message: "ZCode 未运行于换肤模式，无需恢复。" };
      const target = await cdp.pickTarget();
      if (!target) return { ok: false, message: "未找到可操作的页面目标。" };
      const ws = await cdp.connectWs(target.webSocketDebuggerUrl);
      try {
        const removed = await cdp.evaluate(ws, skin.removeJs);
        if (removed === true) { config.get().appliedId = null; config.saveConfig(); }
        return { ok: true, message: removed === true ? "已恢复 ZCode 原始外观（主题已保留）。" : "页面上没有皮肤。" };
      } finally { try { ws.close(); } catch {} }
    } catch (e) {
      log("restore", "恢复失败: " + e.message);
      return { ok: false, message: "恢复失败：" + e.message };
    }
  });
  const out = r.busy ? { ok: false, message: r.message } : r;
  if (out.ok) { try { state.trayRebuild && state.trayRebuild(); } catch {} } // 勾选态复位
  return out;
}

/* launchZcode 由 main.js 注入（含进程启动实现），本模块不直接管理子进程 */
let launchZcode = () => false;

function register(deps) {
  if (deps && typeof deps.launchZcode === "function") launchZcode = deps.launchZcode;

  ipcMain.handle("get-status", async () => ({ ...(await probeStatus()), appliedId: config.get().appliedId }));

  ipcMain.handle("set-appearance", (_e, value) => {
    if (["follow", "zai-dark", "zai-light"].includes(value)) { config.get().appearance = value; config.saveConfig(); }
    return config.publicState();
  });

  ipcMain.handle("set-rotation", (_e, patch) => {
    const rot = config.get().rotation;
    patch = patch || {};
    if (typeof patch.enabled === "boolean") rot.enabled = patch.enabled;
    if ([1, 5, 30, 60, 180, 1440].includes(patch.intervalMin)) rot.intervalMin = patch.intervalMin;
    if (["sequential", "random"].includes(patch.order)) rot.order = patch.order;
    config.saveConfig();
    require("../rotation").startRotationTimer();
    return config.publicState();
  });

  ipcMain.handle("toggle-rotation-theme", (_e, id) => {
    const t = config.get().themes.find(x => x.id === id);
    if (t) { t.inRotation = !t.inRotation; config.saveConfig(); }
    return config.publicState();
  });

  ipcMain.handle("enable-skin", (_e, targetId) => enableSkinViaIpc(targetId));
  ipcMain.handle("restore", restoreSkinViaIpc);
  state.trayApply = () => enableSkinViaIpc();
  state.trayRestore = restoreSkinViaIpc;

  /* C1/C3 运行偏好：开机自启、自动应用、全局快捷键 */
  ipcMain.handle("set-runtime-prefs", (_e, patch) => {
    const cfg = config.get();
    patch = patch || {};
    if (typeof patch.autoApply === "boolean") cfg.autoApply = patch.autoApply;
    if (typeof patch.hotkeys === "boolean") {
      cfg.hotkeys.enabled = patch.hotkeys;
      require("../hotkeys").applyHotkeys();
    }
    if (typeof patch.autostart === "boolean") {
      cfg.autostart = patch.autostart;
      try {
        const { app } = require("electron");
        if (app.isPackaged) {
          app.setLoginItemSettings({ openAtLogin: patch.autostart, path: process.execPath, args: ["--hidden"] });
        } else {
          log("autostart", "开发模式不写系统登录项，仅记录偏好");
        }
      } catch (e) {
        log("autostart", "登录项设置失败: " + e.message);
      }
    }
    config.saveConfig();
    return config.publicState();
  });

  /* D1 连接自测向导 */
  ipcMain.handle("run-diagnostics", async () => {
    try {
      return await require("../diag").runDiagnostics();
    } catch (e) {
      log("diag", "自测异常: " + e.message);
      return { ok: false, message: "诊断执行异常：" + e.message };
    }
  });
}

module.exports = { register, probeStatus, enableSkinViaIpc, restoreSkinViaIpc };
