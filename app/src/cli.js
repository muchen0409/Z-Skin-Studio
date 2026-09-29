/* C7 命令行调用：--apply <主题id|名称> / --restore / --status。
   冷启动：whenReady 里检测到命令则执行后退出（不弹窗口）；
   已驻留：second-instance 事件把新实例的 argv 交给 handleIfRequested 处理。
   已知限制：Windows GUI 程序从控制台启动时 stdout 不回显，--status 的 JSON 输出
   仅在可捕获 stdout 的环境（脚本管道）下可见；驻留时以主窗口状态栏为准 */
const config = require("./config");
const { log } = require("./log");

/* 纯解析（供单测）：返回 { command: "apply"|"restore"|"status"|null, id? } */
function parseCliArgs(argv = []) {
  if (argv.includes("--apply")) {
    const i = argv.indexOf("--apply");
    const id = argv[i + 1];
    return { command: "apply", id: id === undefined || String(id).startsWith("--") ? null : String(id) };
  }
  if (argv.includes("--restore")) return { command: "restore" };
  if (argv.includes("--status")) return { command: "status" };
  return { command: null };
}

/* 主题定位：id 精确 → 名称精确 → 名称前缀；找不到返回 null */
function resolveThemeId(idOrName) {
  if (!idOrName) return null;
  const themes = config.get().themes || [];
  const t = themes.find(x => x.id === idOrName)
    || themes.find(x => x.name === idOrName)
    || themes.find(x => x.name.startsWith(idOrName));
  return t ? t.id : null;
}

/* 执行命令；返回执行结果（status 额外写一行 JSON 到 stdout） */
async function handleCliArgs(args) {
  const runtime = require("./ipc/runtime");
  if (args.command === "status") {
    const st = await runtime.probeStatus();
    const out = {
      ok: true,
      appliedId: config.get().appliedId || null,
      state: st.state,
      skinned: st.state === "skinned",
    };
    try { process.stdout.write(JSON.stringify(out) + "\n"); } catch {}
    return out;
  }
  if (args.command === "restore") {
    const r = await runtime.restoreSkinViaIpc();
    log("cli", "restore: " + (r.message || ""));
    return r;
  }
  if (args.command === "apply") {
    const id = resolveThemeId(args.id);
    if (!id) {
      const msg = "未找到主题：" + (args.id || "(未指定)") + "（可传主题 id 或名称）";
      log("cli", "apply 失败: " + msg);
      return { ok: false, message: msg };
    }
    const r = await runtime.enableSkinViaIpc(id);
    log("cli", "apply: " + (r.message || ""));
    return r;
  }
  return null;
}

/* 已驻留实例收到 second-instance 时调用：status 无法回传 stdout，改为唤出主窗口 */
async function handleIfRequested(argv) {
  const args = parseCliArgs(argv || []);
  if (!args.command) return null;
  if (args.command === "status") {
    const { state } = require("./state");
    if (state.win) { state.win.show(); state.win.focus(); }
    return { ok: true, shownWindow: true };
  }
  return handleCliArgs(args);
}

module.exports = { parseCliArgs, resolveThemeId, handleCliArgs, handleIfRequested };
