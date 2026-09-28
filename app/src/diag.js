/* D1 连接自测向导 + D2 选择器健康检测。
   按链路顺序检查：exe → 进程 → 调试端口 → CDP 目标 → 皮肤注入 → 选择器命中率，
   输出逐步骤的可读报告，并把选择器健康快照落盘供状态栏告警 */
const fs = require("node:fs");
const config = require("./config");
const { state } = require("./state");
const { log } = require("./log");
const cdp = require("./cdp");
const zcode = require("./zcode");
const skin = require("./skin");

/* D2 关键选择器：这些是换肤 CSS 的承重墙，ZCode 升级后任一归零即意味着皮肤可能失效。
   main 用后代匹配兼容新旧 DOM（v3.14.x 起 section 不再是 #content 的直接子元素） */
const KEY_SELECTORS = {
  root: "#root",
  main: "#content section",
  sidebar: "#sidebar",
  composer: "#root .bg-input",
  message: "#root .bg-surface",
};

function selectorHealth() {
  const st = config.get().selectorStats;
  if (!st || !st.checkedAt) return null;
  const cur = zcode.getCachedZcodeVersion();
  if (cur && st.zcodeVersion && cur !== st.zcodeVersion) {
    return { level: "stale", stats: st, message: `ZCode 已升级（${st.zcodeVersion} → ${cur}），界面选择器可能失效，建议重新诊断` };
  }
  if ((st.zeroCore || 0) > 0) {
    return { level: "degraded", stats: st, message: `有 ${st.zeroCore} 个关键选择器在当前页面未命中，皮肤可能显示异常` };
  }
  return { level: "ok", stats: st, message: `选择器健康（${st.zcodeVersion || "?"} 时诊断）` };
}

async function runDiagnostics() {
  const cfg = config.get();
  const steps = [];

  // 1. exe 路径
  const exe = cfg.zcodeExe || config.findZcodeExe();
  const exeOk = !!(exe && fs.existsSync(exe));
  steps.push({
    id: "exe", ok: exeOk, name: "ZCode.exe 路径",
    detail: exe || "未设置",
    hint: exeOk ? null : (exe ? "路径不存在，请在「更改 ZCode 路径」重新指定" : "未找到 ZCode.exe，请手动指定路径"),
  });

  // 2. ZCode 进程
  const running = await zcode.zcodeRunning();
  steps.push({
    id: "proc", ok: running, name: "ZCode 进程",
    detail: running ? "运行中" : "未运行",
    hint: running ? null : "从启动器点「启用皮肤」会自动拉起 ZCode",
  });

  // 3. 调试端口
  const reachable = running ? await cdp.cdpReachable() : false;
  steps.push({
    id: "port", ok: reachable, name: `调试端口 ${cdp.PORT}`,
    detail: reachable ? "可连接" : (running ? "不可连接" : "未检测（ZCode 未运行）"),
    hint: reachable ? null : (running
      ? "ZCode 以普通方式运行，未开调试端口。请完全退出 ZCode（含托盘）后由启动器拉起"
      : null),
  });

  // 4. CDP 目标
  const target = reachable ? await cdp.pickTarget().catch(() => null) : null;
  steps.push({
    id: "target", ok: !!target, name: "页面目标",
    detail: target ? `已定位「${target.title}」` : (reachable ? "端口可达但未找到页面目标" : "未检测"),
    hint: reachable && !target ? "ZCode 主窗口可能尚未加载完成，稍后重试" : null,
  });

  // 5. 皮肤注入状态
  const session = !!(state.skinSession && state.skinSession.ws.readyState === 1);
  let skinned = false;
  if (target) {
    if (session) {
      try { skinned = (await cdp.evaluate(state.skinSession.ws, `!!document.getElementById("zskin-style")`)) === true; }
      catch { skinned = false; }
    } else {
      const ws = await cdp.connectWs(target.webSocketDebuggerUrl).catch(() => null);
      if (ws) {
        try { skinned = (await cdp.evaluate(ws, `!!document.getElementById("zskin-style")`)) === true; }
        catch { skinned = false; }
        finally { try { ws.close(); } catch {} }
      }
    }
  }
  steps.push({
    id: "skin", ok: skinned, name: "皮肤注入",
    detail: skinned ? "已注入" : (session ? "会话存在但页面未见注入层" : "未注入"),
    hint: skinned ? null : "皮肤未启用时属正常状态；若已启用仍显示未注入，请看下一步选择器检查",
  });

  // 6. D2 选择器命中率
  let hits = null;
  if (target) {
    const ws = session ? state.skinSession.ws : await cdp.connectWs(target.webSocketDebuggerUrl).catch(() => null);
    if (ws) {
      try {
        hits = await cdp.evaluate(ws, `(function(){
  var sels = ${JSON.stringify(KEY_SELECTORS)};
  var out = {};
  for (var k in sels) { try { out[k] = document.querySelectorAll(sels[k]).length; } catch (e) { out[k] = -1; } }
  return out;
})()`);
      } catch (e) {
        log("diag", "选择器检查失败: " + e.message);
      }
      finally { if (!session) { try { ws.close(); } catch {} } }
    }
  }
  const zeroSel = hits ? Object.keys(KEY_SELECTORS).filter(k => hits[k] === 0) : [];
  const coreMissing = hits ? ["root", "main", "sidebar"].filter(k => hits[k] === 0) : [];
  steps.push({
    id: "selectors", ok: !!hits && coreMissing.length === 0, name: "D2 关键选择器命中",
    detail: hits
      ? Object.keys(KEY_SELECTORS).map(k => `${k}:${hits[k]}`).join("　") +
        (zeroSel.length ? `　⚠ 未命中：${zeroSel.join(", ")}` : "")
      : "未检测（需要页面目标）",
    hint: hits && coreMissing.length
      ? `核心结构（${coreMissing.join("/")}) 未命中——ZCode 界面结构可能已变化，皮肤会部分或全部失效`
      : (hits && zeroSel.length
        ? "次要选择器未命中（弹窗/输入框样式可能不生效），核心结构正常"
        : null),
  });

  // 快照落盘 + 版本对比
  let zcodeVersion = null;
  try { zcodeVersion = zcode.getCachedZcodeVersion(); } catch {}
  const health = selectorHealth();
  config.get().selectorStats = {
    checkedAt: Date.now(),
    zcodeVersion,
    hits: hits || {},
    zeroCore: coreMissing.length,
  };
  config.saveConfig();

  const overall = exeOk && reachable && !!target && coreMissing.length === 0;
  log("diag", `自测完成：${overall ? "通过" : "发现问题"}（选择器核心缺失 ${coreMissing.length}）`);
  return { ok: true, overall, steps, zcodeVersion, health };
}

module.exports = { runDiagnostics, selectorHealth, KEY_SELECTORS };
