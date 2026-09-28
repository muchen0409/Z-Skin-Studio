/* 集中可变状态：原先散落在 main.js 顶层的全局变量收敛于此（单例，require 缓存保证） */
const state = {
  win: null,
  tray: null,
  trayApply: null,
  trayRestore: null,
  opBusy: false,      // enable/restore/rotate 操作互斥标志
  opBusySince: 0,     // 置位时刻，供 probeStatus 做 60s 卡死兜底
  skinSession: null,  // 持久注入会话 { ws, url, scriptId, theme, light, watchdog }
  rotateTimer: null,
  zcodePid: null,     // 由启动器拉起的 ZCode 进程号，用于免 tasklist 探活
  gpuOff: false,      // 软件渲染模式（gpu-off.flag），UI 据此降级 blur
};

/* 操作互斥包装器：任何退出路径（含异常）都保证复位 opBusy */
async function withBusy(fn) {
  if (state.opBusy) return { ok: false, busy: true, message: "上一个操作还在执行中，请稍候。" };
  state.opBusy = true;
  state.opBusySince = Date.now();
  try {
    return await fn();
  } finally {
    state.opBusy = false;
  }
}

module.exports = { state, withBusy };
