/* 换肤引擎：CSS 构建（DreamSkin 兼容层）、注入脚本、持久会话、看门狗 */
const crypto = require("node:crypto");
const { CDP, cdpReachable, connectWs, cdpSend, evaluate } = require("./cdp");
const config = require("./config");
const { state } = require("./state");
const { log } = require("./log");
const { POSITIONS, themeAccent } = require("./theme-pack");

/* ---------------- DreamSkin 兼容层 ----------------
   包内 theme.css 用 [data-ds-part="X"] 选择器和 --ds-theme-color-* 变量；
   ZCode 无宿主钩子，这里把选择器映射到真实 DOM、注入变量，并把包样式 !important 化 */
const DS_PART_ALIASES = {
  root: "html",
  // 后代匹配兼容新旧 DOM：旧版 section 是 #content 直接子元素，v3.14.x 起被包进一层 div
  main: "#content section",
  sidebar: "#sidebar, #sidebar aside",
  dialog: '[role="dialog"], [role="alertdialog"]',
  composer: "#root .bg-input",
  message: "#root .bg-surface",
};

/* ---------- CSS 转换（容错版） ----------
   旧实现用单条正则对全文加 !important，会误伤 @media 块内结构与
   url(data:...;base64,...) 声明（分号会截断 data URI）。
   现按块处理：摘出 at-rule 递归、含 url( 的声明整段保护后再逐声明加 !important，
   结束后做大括号配平校验，失败返回 null 由调用方回退通用皮肤 */
function transformDsCss(css) {
  try {
    const out = transformBlock(css);
    let depth = 0;
    for (const ch of out) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth < 0) throw new Error("多余的右括号"); }
    }
    if (depth !== 0) throw new Error("大括号未闭合");
    return out;
  } catch (e) {
    log("ds-css", "theme.css 转换失败，本次跳过包样式: " + e.message);
    return null;
  }
}

/* 处理一段样式：逐个摘出顶层 at-rule 块（括号配平），其余按普通规则处理 */
function transformBlock(text) {
  let out = "";
  let rest = text;
  const AT_RE = /@([a-zA-Z-]+)([^{]*)\{/;
  for (;;) {
    const m = rest.match(AT_RE);
    if (!m) { out += transformRules(rest); break; }
    let depth = 1, i = m.index + m[0].length;
    while (i < rest.length && depth > 0) {
      if (rest[i] === "{") depth++;
      else if (rest[i] === "}") depth--;
      i++;
    }
    if (depth !== 0) throw new Error("@" + m[1] + " 块未闭合");
    const body = rest.slice(m.index + m[0].length, i - 1);
    out += transformRules(rest.slice(0, m.index));
    const name = m[1].toLowerCase();
    if (name === "media" || name === "supports") {
      out += "@" + m[1] + m[2] + "{" + transformBlock(body) + "}";
    } else {
      // @keyframes / @font-face 等内嵌结构不做映射与 !important 化，原样保留
      out += rest.slice(m.index, i);
    }
    rest = rest.slice(i);
  }
  return out;
}

/* 普通规则段：选择器映射 + 声明 !important 化。
   含 url( 的声明先整段摘出（data URI 里的分号/冒号会干扰逐声明切分），处理完再拼回 */
function transformRules(text) {
  const stash = [];
  text = text.replace(/[-a-zA-Z]+\s*:\s*[^;{}]*url\([^)]*\)[^;{}]*/gi, m => {
    stash.push(m);
    return `\u0000${stash.length - 1}\u0000`;
  });
  const out = text.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
    const mapped = sel.replace(/\[data-ds-part="(\w+)"\]/g, (s, part) => DS_PART_ALIASES[part] || s);
    const newBody = body.replace(/([-a-zA-Z]+)\s*:\s*([^;]*);?/g, (d, prop, val) => {
      if (!prop || !String(val).trim()) return d;
      if (/!important/.test(val)) return d;
      return `${prop}: ${String(val).trim()} !important;`;
    }).replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] || "");
    return mapped + "{" + newBody + "}";
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] || "");
}

function dsVarsCss(theme, alpha) {
  const c = theme.dsColors || {};
  const panelA = Math.min(0.9, alpha + 0.18);
  const bgA = Math.min(0.9, alpha + 0.08);
  const tint = hex => {
    const rgb = require("./theme-pack").hexToRgb(hex);
    return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null;
  };
  const surface = (hex, a) => {
    const t = tint(hex);
    return t ? `rgba(${t.r}, ${t.g}, ${t.b}, ${a})` : hex; // 非纯 hex（如 rgba 字符串）原样保留
  };
  const line = (v) => /^#/.test(v) ? surface(v, Math.min(0.9, alpha + 0.25)) : v;
  const vars = {
    "--ds-theme-color-background": surface(c.background, bgA),
    "--ds-theme-color-panel": surface(c.panel, panelA),
    "--ds-theme-color-panel-alt": surface(c.panelAlt, panelA),
    "--ds-theme-color-accent": c.accent,
    "--ds-theme-color-accent-alt": c.accentAlt,
    "--ds-theme-color-secondary": c.secondary,
    "--ds-theme-color-highlight": c.highlight,
    "--ds-theme-color-text": c.text,
    "--ds-theme-color-muted": c.muted,
    "--ds-theme-color-line": c.line ? line(c.line) : undefined,
    "--ds-theme-surface-radius": "12px",
    "--ds-theme-surface-blur": "14px",
  };
  const lines = Object.entries(vars).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v} !important;`);
  return `:root {\n${lines.join("\n")}\n}`;
}

function buildSkinCssUncached(theme, light) {
  const url = `file:///${encodeURI(theme.file.replace(/\\/g, "/"))}`;
  const a = Math.min(0.9, Math.max(0.02, theme.alpha));
  const pos = POSITIONS[theme.position] || POSITIONS.center;
  // A1 背景滤镜：blur 时轻微放大抵消边缘羽化发白
  const f = theme.filter || {};
  const filt = [];
  const blur = Math.min(20, Math.max(0, f.blur || 0));
  if (blur > 0) filt.push(`blur(${blur}px)`);
  if (typeof f.brightness === "number" && f.brightness !== 1) filt.push(`brightness(${f.brightness})`);
  if (typeof f.contrast === "number" && f.contrast !== 1) filt.push(`contrast(${f.contrast})`);
  if (typeof f.saturate === "number" && f.saturate !== 1) filt.push(`saturate(${f.saturate})`);
  const filterCss = filt.length
    ? `  filter: ${filt.join(" ")};\n${blur > 0 ? `  transform: scale(${(1 + blur * 0.004).toFixed(3)});\n` : ""}` : "";
  // A2 可读性遮罩：上下渐变 + 暗角，浅色图上保证文字可读
  const shade = shadeCss(theme.shade);
  // 滚动条/选中文本跟随主题 accent（主题包用包内 token，普通主题用导入时缓存的取色）
  const [ar, ag, ab] = themeAccent(theme);
  // 两套调色板：深色沿用 ZCode 暗色 token；浅色用 ZCode 浅色 token（背景 #f8f8f8）
  // 浅色只轻微抬高透明度保证文字可读，避免明显白纱
  const P = light ? {
    main: `rgba(255, 255, 255, ${Math.min(0.9, a + 0.12)})`,
    section: `rgba(248, 248, 248, ${Math.min(0.9, a + 0.12)})`,
    sidebar: `rgba(255, 255, 255, ${Math.min(0.9, a + 0.10)})`,
    surfaceVar: `rgba(255, 255, 255, ${Math.min(0.9, a + 0.16)})`,
    tagVar: `rgba(255, 255, 255, ${Math.min(0.9, a + 0.14)})`,
    bgBackground: `rgba(248, 248, 248, ${Math.min(0.9, a + 0.12)})`,
    card: `rgba(255, 255, 255, ${Math.min(0.9, a + 0.16)})`,
    dialog: `rgba(255, 255, 255, ${Math.min(0.9, a + 0.18)})`,
  } : {
    main: `rgba(43, 43, 43, ${a})`,
    section: `rgba(22, 22, 22, ${a})`,
    sidebar: `rgba(30, 30, 30, ${a})`,
    surfaceVar: `rgba(43, 43, 43, ${Math.min(0.9, a + 0.18)})`,
    tagVar: `rgba(54, 54, 54, ${Math.min(0.9, a + 0.12)})`,
    bgBackground: `rgba(22, 22, 22, ${a})`,
    card: `rgba(30, 30, 30, ${Math.min(0.9, a + 0.12)})`,
    dialog: `rgba(30, 30, 30, ${Math.min(0.9, a + 0.15)})`,
  };
  // 包样式可能转换失败 → 视同无包样式，回退通用皮肤（card/dialog 默认规则补上）
  const mappedDs = theme.dsCss ? transformDsCss(theme.dsCss) : null;
  let css = `
#zskin-layer {
  z-index: 0 !important;
  opacity: 1;
  background: url("${url}") ${pos} / cover no-repeat;
${filterCss}}
${shade}
#root { position: relative; z-index: 1; background: transparent !important; }
#root .h-dvh { background-color: ${P.main} !important; }
#content section { background-color: ${P.section} !important; }
#sidebar, #sidebar aside { background-color: ${P.sidebar} !important; }

/* Tailwind v4 主题变量级覆盖：输入框/卡片/弹出菜单/标签这些表面色全面半透明
   （深色变量原值：input/card/popover #2b2b2b、tag #363636；浅色为白色系） */
:root {
  --color-input: ${P.surfaceVar} !important;
  --color-card: ${P.surfaceVar} !important;
  --color-popover: ${P.surfaceVar} !important;
  --color-tag: ${P.tagVar} !important;
}

/* ZCode 的面板/弹窗/弹层统一用 Tailwind bg-* 工具类，按类名通配成半透明 */
#root .bg-background { background-color: ${P.bgBackground} !important; }
${mappedDs ? "" : `#root .bg-card, #root .bg-popover {
  background-color: ${P.card} !important;
}`}${mappedDs ? "" : `
#root [role="dialog"], #root [role="alertdialog"],
body > div [role="dialog"], body > div [role="alertdialog"] {
  background-color: ${P.dialog} !important;
}`}

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(${ar}, ${ag}, ${ab}, .55);
  border-radius: 6px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::selection { background: rgba(${ar}, ${ag}, ${ab}, .42); }
`;
  // DreamSkin 包样式：变量 + 映射后的 theme.css（!important 化，附加在最后以覆盖通用规则）
  if (mappedDs) {
    css += "\n/* --- DreamSkin 主题包样式（dialog/composer/message 等映射到 ZCode DOM） --- */\n";
    css += dsVarsCss(theme, a) + "\n";
    css += mappedDs + "\n";
  }
  return css;
}

/* 构建缓存：看门狗重注入时直接命中，消除每 4 秒的整段 CSS 重算 */
const cssCache = new Map();

/* A2 可读性遮罩强度：1=轻 2=重；0=不注入 */
function shadeCss(level) {
  if (level !== 1 && level !== 2) return "";
  const s = level === 2 ? { top: 0.38, vig: 0.32 } : { top: 0.22, vig: 0.18 };
  return `
#zskin-layer::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,${s.top}), transparent 26%, transparent 74%, rgba(0,0,0,${s.top})),
              radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,${s.vig}) 100%);
}`;
}

function buildSkinCss(theme, light) {
  const fp = [theme.id, theme.alpha, theme.position, light ? "L" : "D",
    theme.dsCss ? crypto.createHash("sha256").update(theme.dsCss).digest("hex").slice(0, 12) : "-",
    theme.dsColors ? crypto.createHash("sha256").update(JSON.stringify(theme.dsColors)).digest("hex").slice(0, 12) : "-",
    theme.shade || 0,
    theme.filter ? JSON.stringify(theme.filter) : "-",
  ].join("|");
  if (cssCache.has(fp)) return cssCache.get(fp);
  const css = buildSkinCssUncached(theme, light);
  if (cssCache.size > 32) cssCache.clear();
  cssCache.set(fp, css);
  return css;
}

const injectJs = css => `(function(){
  try {
    var old = document.getElementById("zskin-active");
    if (old) old.remove();
    var layer = document.getElementById("zskin-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "zskin-layer";
      layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
      (document.body || document.documentElement).appendChild(layer);
    }
    var st = document.getElementById("zskin-style") || document.createElement("style");
    st.id = "zskin-style";
    st.setAttribute("data-zskin", "1");
    st.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(st);
    return true;
  } catch (e) { return "ERR:" + (e && e.message); }
})()`;

const removeJs = `(function(){
  try {
    var r = false;
    ["zskin-style", "zskin-layer"].forEach(function(id) {
      var n = document.getElementById(id);
      if (n) { n.remove(); r = true; }
    });
    return r;
  } catch (e) { return "ERR:" + (e && e.message); }
})()`;

function appearanceJs(want) {
  return `(function(){
    try {
      localStorage.setItem("zcode-theme", ${JSON.stringify(want)});
      var light = ${want === "zai-light"};
      var c = document.documentElement.classList;
      c.toggle("dark", !light);
      c.toggle("theme-zai-dark", !light);
      c.toggle("theme-zai-light", light);
      document.documentElement.setAttribute("data-zcode-browser-theme-surface", light ? "light" : "dark");
      document.documentElement.style.colorScheme = light ? "light" : "dark";
    } catch (e) {}
  })()`;
}

async function registerSkin(ws, theme, light) {
  const scriptId = (await cdpSend(ws, "Page.addScriptToEvaluateOnNewDocument", {
    source: injectJs(buildSkinCss(theme, light)),
    runImmediately: true,
  })).identifier;
  const r = await evaluate(ws, injectJs(buildSkinCss(theme, light)));
  if (r !== true) throw new Error(String(r));
  if (!(await evaluate(ws, `!!document.getElementById("zskin-style")`))) throw new Error("注入后校验失败");
  return scriptId;
}

/* 断线（页面重载导致目标重建、ZCode 重启等）自动重连：
   指数退避 2s → 4s → … 上限 60s，先探端口再连，端口不在时长休眠空转 */
function watchSession() {
  state.skinSession.ws.on("close", () => {
    if (!state.skinSession) return;
    const { url, theme, light } = state.skinSession;
    state.skinSession = null;
    let delay = 2000;
    const attempt = async () => {
      if (!config.get().appliedId) return; // 用户已恢复外观，停止重连
      if (!(await cdpReachable())) {
        setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 60000);
        return;
      }
      try {
        const ws = await connectWs(url);
        await cdpSend(ws, "Page.enable");
        const scriptId = await registerSkin(ws, theme, light);
        state.skinSession = { ws, url, scriptId, theme, light };
        startWatchdog();
        watchSession();
        log("session", "皮肤会话已重连");
      } catch (e) {
        log("session", "重连失败（" + Math.round(delay / 1000) + "s 后重试）: " + e.message);
        setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 60000);
      }
    };
    setTimeout(attempt, 1500);
  });
}

/* 皮肤丢失看门狗 + 刷新事件重注入：addScriptToEvaluateOnNewDocument 在
   Electron 多 CDP 会话下不可靠，用 loadEventFired 推送 + 定期检查兜底。
   inflight 标志防止上一轮未结束时并发堆积 */
function startWatchdog() {
  if (state.skinSession.watchdog) clearInterval(state.skinSession.watchdog);
  const s = state.skinSession;
  s.watchInflight = false;
  s.ws.addEventListener("message", ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === "Page.loadEventFired") setTimeout(() => reapplySkin(), 200);
  });
  s.watchdog = setInterval(async () => {
    if (s.watchInflight) return;
    if (state.skinSession !== s || s.ws.readyState !== 1) { clearInterval(s.watchdog); return; }
    s.watchInflight = true;
    try {
      const alive = await evaluate(s.ws, `!!document.getElementById("zskin-style")`);
      if (alive !== true) await reapplySkin();
    } catch (e) {
      log("watchdog", "检查失败: " + e.message);
    } finally {
      s.watchInflight = false;
    }
  }, 4000);
}

async function reapplySkin() {
  const s = state.skinSession;
  if (!s || s.ws.readyState !== 1) return;
  try {
    if (config.get().appearance !== "follow") await evaluate(s.ws, appearanceJs(config.get().appearance));
    await evaluate(s.ws, injectJs(buildSkinCss(s.theme, s.light)));
  } catch (e) {
    log("watchdog", "重注入失败: " + e.message);
  }
}

async function injectSkinPersistent(theme) {
  const { waitTarget } = require("./cdp");
  const target = await waitTarget();
  if (!target) return { ok: false, message: "未找到可注入的页面目标（等待 20 秒超时）。" };
  // 已有旧会话先彻底拆除，避免重复注册
  await teardownSession().catch(e => log("session", "旧会话拆除失败: " + e.message));

  const ws = await connectWs(target.webSocketDebuggerUrl);
  await cdpSend(ws, "Page.enable");
  const cfg = config.get();
  const want = cfg.appearance && cfg.appearance !== "follow" ? cfg.appearance : null;
  if (want) await evaluate(ws, appearanceJs(want));
  const light = Boolean(await evaluate(ws, `!document.documentElement.classList.contains("dark")`));
  const scriptId = await registerSkin(ws, theme, light);

  state.skinSession = { ws, url: target.webSocketDebuggerUrl, scriptId, theme, light };
  startWatchdog();
  watchSession();
  return { ok: true, light, title: target.title };
}

async function teardownSession() {
  const s = state.skinSession;
  if (!s) return;
  if (s.watchdog) clearInterval(s.watchdog);
  state.skinSession = null; // 先置空，阻止 close 回调触发重连
  try {
    await cdpSend(s.ws, "Page.removeScriptToEvaluateOnNewDocument", { identifier: s.scriptId });
    await evaluate(s.ws, removeJs);
  } catch (e) {
    log("session", "持久脚本清理失败（连接可能已断）: " + e.message);
  }
  try { s.ws.close(); } catch {}
}

/* 在持久会话上热切换主题：换持久脚本 + 立即重注入，不动连接。
   persist=false 时为 A4 实时预览：注入但不动 appliedId（ZCode 重启/恢复后即消失） */
async function switchSkinTheme(theme, opts = {}) {
  const persist = opts.persist !== false;
  const s = state.skinSession;
  if (!s || s.ws.readyState !== 1) return { ok: false, message: "皮肤未启用" };
  try {
    if (s.scriptId) {
      await cdpSend(s.ws, "Page.removeScriptToEvaluateOnNewDocument", { identifier: s.scriptId }).catch(e => log("rotate", "旧脚本移除失败: " + e.message));
    }
    const scriptId = (await cdpSend(s.ws, "Page.addScriptToEvaluateOnNewDocument", {
      source: injectJs(buildSkinCss(theme, s.light)),
      runImmediately: true,
    })).identifier;
    await evaluate(s.ws, injectJs(buildSkinCss(theme, s.light)));
    s.theme = theme;
    s.scriptId = scriptId;
    if (persist) {
      config.get().appliedId = theme.id;
      config.saveConfig();
      if (state.trayRebuild) state.trayRebuild(); // 托盘"切换主题"子菜单的勾选态跟随
    }
    return { ok: true };
  } catch (e) {
    log("rotate", "热切换失败: " + e.message);
    return { ok: false, message: e.message };
  }
}

/* A4 实时预览：与热切换同路径，但不落盘 appliedId */
async function previewTheme(theme) {
  return switchSkinTheme(theme, { persist: false });
}

module.exports = {
  DS_PART_ALIASES, transformDsCss, dsVarsCss, buildSkinCss,
  injectJs, removeJs, appearanceJs, registerSkin, watchSession, startWatchdog,
  reapplySkin, injectSkinPersistent, teardownSession, switchSkinTheme, previewTheme,
};
