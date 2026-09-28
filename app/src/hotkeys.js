/* C3 全局快捷键：切换皮肤 / 下一主题（可在设置中关闭） */
const { globalShortcut } = require("electron");
const config = require("./config");
const { state } = require("./state");
const { log } = require("./log");

const BINDINGS = [
  { key: "Alt+Shift+S", desc: "切换皮肤（开/关）" },
  { key: "Alt+Shift+N", desc: "下一个主题" },
];

async function toggleSkin() {
  const runtime = require("./ipc/runtime");
  const skinned = state.skinSession && state.skinSession.ws.readyState === 1;
  const r = skinned ? await runtime.restoreSkinViaIpc() : await runtime.enableSkinViaIpc();
  if (state.tray) state.tray.setToolTip("Zcode+ — " + (r.message || ""));
  log("hotkey", "切换皮肤: " + (r.message || ""));
}

async function nextTheme() {
  const r = await require("./rotation").advanceNow();
  if (state.tray) state.tray.setToolTip("Zcode+ — " + (r.message || ""));
}

/* 按 config.hotkeys.enabled 注册/注销；改动设置后需重新调用 */
function applyHotkeys() {
  try { globalShortcut.unregisterAll(); } catch {}
  if (!config.get().hotkeys.enabled) return;
  for (const b of BINDINGS) {
    try {
      const ok = globalShortcut.register(b.key, b.desc.startsWith("切换") ? toggleSkin : nextTheme);
      if (!ok) log("hotkey", "快捷键注册失败（可能被其他程序占用）: " + b.key);
    } catch (e) {
      log("hotkey", "快捷键注册异常 " + b.key + ": " + e.message);
    }
  }
}

module.exports = { applyHotkeys, BINDINGS };
