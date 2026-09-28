/* 主题定时轮换：轮换池选取与定时器，热切换纳入全局操作互斥 */
const crypto = require("node:crypto");
const config = require("./config");
const { state, withBusy } = require("./state");
const { log } = require("./log");
const { switchSkinTheme } = require("./skin");

function startRotationTimer() {
  stopRotationTimer();
  if (!config.get().rotation.enabled) return;
  const ms = Math.max(1, config.get().rotation.intervalMin || 60) * 60000;
  state.rotateTimer = setInterval(() => {
    rotateOnce().catch(e => log("rotate", "轮换异常: " + e.message));
  }, ms);
}

function stopRotationTimer() {
  if (state.rotateTimer) { clearInterval(state.rotateTimer); state.rotateTimer = null; }
}

/* 从轮换池选下一个主题（顺序 = 当前使用主题的下一个；随机 = 排除当前）。
   fallbackAll=true 时池为空则回退到全部主题（供手动"下一主题"使用） */
function pickNextRotationTheme(fallbackAll = false) {
  const cfg = config.get();
  let pool = cfg.themes.filter(t => t.inRotation);
  if (!pool.length && fallbackAll) pool = cfg.themes.slice();
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  if (cfg.rotation.order === "random") {
    const others = pool.filter(t => t.id !== cfg.appliedId);
    const list = others.length ? others : pool;
    return list[crypto.randomInt(list.length)];
  }
  const idx = pool.findIndex(t => t.id === cfg.appliedId);
  return pool[(idx + 1) % pool.length];
}

/* 轮换 tick：仅当皮肤已启用时切换，否则静默跳过。
   与手动 enable/restore 走同一 withBusy 互斥，避免并发覆盖 scriptId */
async function rotateOnce() {
  if (!state.skinSession || state.skinSession.ws.readyState !== 1) return; // 皮肤未启用
  const next = pickNextRotationTheme();
  if (!next || next.id === config.get().appliedId) return;
  const r = await withBusy(() => switchSkinTheme(next));
  if (r && r.ok) log("rotate", "已轮换到「" + next.name + "」");
}

/* 手动"下一主题"（C3 快捷键/脚本调用）：池为空时回退全部主题，返回可读结果 */
async function advanceNow() {
  if (!state.skinSession || state.skinSession.ws.readyState !== 1) {
    return { ok: false, message: "皮肤未启用，无法切换主题" };
  }
  const next = pickNextRotationTheme(true);
  if (!next) return { ok: false, message: "没有可切换的主题" };
  if (next.id === config.get().appliedId && config.get().themes.length === 1) {
    return { ok: true, message: "只有一个主题，无需切换" };
  }
  const r = await withBusy(() => switchSkinTheme(next));
  if (r && r.ok) {
    log("rotate", "手动切换到「" + next.name + "」");
    return { ok: true, message: "已切换到「" + next.name + "」", theme: next };
  }
  return r.busy ? { ok: false, message: r.message } : r;
}

module.exports = { startRotationTimer, stopRotationTimer, pickNextRotationTheme, rotateOnce, advanceNow };
