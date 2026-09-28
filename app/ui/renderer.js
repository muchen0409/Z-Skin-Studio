/* Zcode+ 管理控制台 — 渲染层逻辑（经 preload 暴露的 window.zskin 与主进程通信） */
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let state = null;

  const ICONS = {
    rename: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  };

  function applyAccent(rgb) {
    if (!Array.isArray(rgb)) return;
    const [r, g, b] = rgb;
    const root = document.documentElement.style;
    root.setProperty("--accent", `rgb(${r},${g},${b})`);
    root.setProperty("--accent-soft", `rgba(${r},${g},${b},.18)`);
    root.setProperty("--accent-deep", `rgb(${Math.round(r*.72)},${Math.round(g*.72)},${Math.round(b*.72)})`);
  }

  function fmtAlpha(v) { return "." + String(v).padStart(2, "0"); }

  /* ---------- 主题网格（按 id 增量更新，不再整屏重建 DOM） ---------- */
  function buildCard() {
    const card = document.createElement("div");
    card.className = "theme-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    const foot = document.createElement("div");
    foot.className = "foot";
    const name = document.createElement("span");
    name.className = "name";
    const more = document.createElement("button");
    more.className = "more"; more.textContent = "⋯";
    more.onclick = e => {
      e.stopPropagation();
      const cur = state.themes.find(x => x.id === card.dataset.id);
      if (cur) openMenu(e.target, cur);
    };
    foot.append(name, more);
    card.append(img, foot);
    card.onclick = () => selectTheme(card.dataset.id);
    card.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTheme(card.dataset.id); } };
    return card;
  }

  function updateCard(card, t) {
    card.dataset.id = t.id;
    card.className = "theme-card" + (t.id === state.draftId ? " selected" : "");
    card.setAttribute("aria-label", "选择主题 " + t.name);
    const src = "file:///" + encodeURI((t.thumb || t.file).replace(/\\/g, "/"));
    const img = card.querySelector("img");
    if (img.getAttribute("src") !== src) img.src = src;
    const name = card.querySelector(".name");
    if (name.textContent !== t.name) name.textContent = t.name;
    card.querySelector(".more").setAttribute("aria-label", t.name + " 的更多操作");
    let badge = card.querySelector(".badge");
    if (t.id === state.appliedId) {
      if (!badge) { badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "使用中"; card.append(badge); }
    } else if (badge) badge.remove();
    let pool = card.querySelector(".pool-badge");
    if (t.inRotation) {
      if (!pool) { pool = document.createElement("span"); pool.className = "pool-badge"; pool.textContent = "轮换"; card.append(pool); }
    } else if (pool) pool.remove();
  }

  function render() {
    const grid = $("#grid");
    let empty = $("#emptyState");
    if (!state.themes.length) {
      if (!empty) {
        empty = document.createElement("div");
        empty.id = "emptyState";
        empty.textContent = "还没有主题 —— 点击右上角「导入主题」，把任意图片变成 ZCode 的氛围背景";
        grid.append(empty);
      }
      grid.querySelectorAll(".theme-card").forEach(c => c.remove());
    } else {
      if (empty) empty.remove();
      const cards = new Map([...grid.querySelectorAll(".theme-card")].map(c => [c.dataset.id, c]));
      const keep = new Set();
      for (const t of state.themes) {
        keep.add(t.id);
        let card = cards.get(t.id);
        if (!card) { card = buildCard(); grid.append(card); }
        updateCard(card, t);
      }
      for (const [id, card] of cards) if (!keep.has(id)) card.remove();
    }
    renderDraftParams();
    renderAppearance();
    renderRotation();
    renderStartupRow();
    renderZcodeRow();
    $("#footVersion").textContent = state.appVersion ? "Zcode+ v" + state.appVersion : "";
  }

  /* ---------- 页面切换 ---------- */
  function renderVersionPage() {
    $("#appVerVal").textContent = "v" + (state.appVersion || "?");
    window.zskin.getZcodeVersion().then(v => {
      $("#zcodeVerVal").textContent = v.version ? "v" + v.version : "未知";
      $("#zcodeExePath").textContent = v.exe || "—";
      if (v.message) $("#zcodeVerResult").textContent = v.message;
    });
  }
  const pages = { skin: $("#pageSkin"), version: $("#pageVersion") };
  $$(".nav-item").forEach(b => b.onclick = () => {
    $$(".nav-item").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    for (const [key, el] of Object.entries(pages)) el.style.display = key === b.dataset.page ? "" : "none";
    if (b.dataset.page === "version") renderVersionPage();
    if (b.dataset.page === "skin") render();
  });

  function draftTheme() {
    // state 未就绪（启动窗口期 getState 尚未返回）时安全返回 null，handler 会走 !t 分支
    return state ? (state.themes.find(t => t.id === state.draftId) || null) : null;
  }

  function renderDraftParams() {
    const t = draftTheme();
    const box = $("#draftParams");
    if (!t) { box.style.display = "none"; renderFilterRow(null); return; }
    box.style.display = "flex";
    $("#alpha").value = Math.round(t.alpha * 100);
    $("#alphaVal").textContent = fmtAlpha(Math.round(t.alpha * 100));
    // 只收窄到草稿参数区，避免清掉深浅色/轮换顺序的分段高亮
    $$("#draftParams .seg button").forEach(b => b.classList.toggle("on", b.dataset.pos === t.position));
    renderFilterRow(t);
  }

  /* A1/A2：滤镜滑块与遮罩档位跟随草稿主题 */
  function renderFilterRow(t) {
    const row = $("#filterRow");
    if (!t) { row.style.display = "none"; return; }
    row.style.display = "flex";
    const f = t.filter || { blur: 0, brightness: 1, contrast: 1, saturate: 1 };
    $("#fBlur").value = f.blur || 0;
    $("#fBlurVal").textContent = (f.blur || 0) + "px";
    $("#fBright").value = Math.round((f.brightness ?? 1) * 100);
    $("#fBrightVal").textContent = Math.round((f.brightness ?? 1) * 100) + "%";
    $("#fContrast").value = Math.round((f.contrast ?? 1) * 100);
    $("#fContrastVal").textContent = Math.round((f.contrast ?? 1) * 100) + "%";
    $("#fSatur").value = Math.round((f.saturate ?? 1) * 100);
    $("#fSaturVal").textContent = Math.round((f.saturate ?? 1) * 100) + "%";
    $$("#filterRow .seg button").forEach(b => b.classList.toggle("on", Number(b.dataset.shade) === (t.shade || 0)));
  }

  function renderStartupRow() {
    $("#autostartSwitch").classList.toggle("on", !!state.autostart);
    $("#autostartSwitch").setAttribute("aria-checked", state.autostart ? "true" : "false");
    $("#autoApplySwitch").classList.toggle("on", !!state.autoApply);
    $("#autoApplySwitch").setAttribute("aria-checked", state.autoApply ? "true" : "false");
    const hk = state.hotkeys || { enabled: true };
    $("#hotkeySwitch").classList.toggle("on", !!hk.enabled);
    $("#hotkeySwitch").setAttribute("aria-checked", hk.enabled ? "true" : "false");
  }

  function renderZcodeRow() {
    $("#zcodeRow").style.display = state.zcodeExe ? "none" : "flex";
  }

  function renderAppearance() {
    $$("#appearanceRow .seg button").forEach(b => b.classList.toggle("on", b.dataset.app === state.appearance));
  }

  function renderRotation() {
    const rot = state.rotation || { enabled: false, intervalMin: 60, order: "sequential" };
    $("#rotSwitch").classList.toggle("on", rot.enabled);
    $("#rotSwitch").setAttribute("aria-checked", rot.enabled ? "true" : "false");
    $("#rotInterval").value = String(rot.intervalMin);
    $$("#rotationRow .seg button").forEach(b => b.classList.toggle("on", b.dataset.order === rot.order));
  }

  function selectTheme(id) {
    if (state.draftId === id) return;
    window.zskin.setDraft(id).then(s => {
      const previewed = s.previewed;
      state = s;
      applyAccent(s.accent);
      render();
      if (previewed) setMsg(`已实时预览「${draftTheme()?.name || ""}」（临时生效）——点「应用主题」保存`, "ok");
    });
  }

  /* ---------- 溢出菜单 ---------- */
  let menuTheme = null;
  function openMenu(anchor, t) {
    menuTheme = t;
    const m = $("#menu");
    m.innerHTML = "";
    const rename = document.createElement("button");
    rename.innerHTML = ICONS.rename + "重命名";
    rename.onclick = () => { closeMenu(); openRename(); };
    const rot = document.createElement("button");
    rot.textContent = t.inRotation ? "移出轮换池" : "加入轮换池";
    rot.onclick = async () => {
      closeMenu();
      state = await window.zskin.toggleRotationTheme(t.id);
      render();
    };
    const del = document.createElement("button");
    del.className = "danger";
    del.innerHTML = ICONS.trash + "删除";
    del.onclick = async () => { closeMenu(); state = await window.zskin.removeTheme(t.id); render(); };
    m.append(rename, rot, del);
    m.classList.add("open");
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - 150) + "px";
    m.style.top = (r.bottom + 6) + "px";
  }
  function closeMenu() { $("#menu").classList.remove("open"); }
  document.addEventListener("click", e => {
    if (!$("#menu").contains(e.target) && !e.target.classList.contains("more")) closeMenu();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenu(); closeModal(); } });

  /* ---------- 重命名模态 ---------- */
  function openRename() {
    $("#modalInput").value = menuTheme ? menuTheme.name : "";
    $("#modalMask").classList.add("open");
    $("#modalInput").focus();
    $("#modalInput").select();
  }
  function closeModal() { $("#modalMask").classList.remove("open"); }
  $("#modalCancel").onclick = closeModal;
  $("#modalOk").onclick = async () => {
    if (menuTheme) {
      state = await window.zskin.renameTheme(menuTheme.id, $("#modalInput").value);
      render();
    }
    closeModal();
  };
  $("#modalInput").onkeydown = e => { if (e.key === "Enter") $("#modalOk").click(); };
  $("#modalMask").onclick = e => { if (e.target === $("#modalMask")) closeModal(); };

  /* ---------- 运行状态 ---------- */
  const STATUS_TEXT = {
    idle: ["ZCode 未运行或不可连接", "off"],
    "running-no-port": ["ZCode 运行中，但未开启调试端口", "warn"],
    connected: ["ZCode 已连接 · 皮肤未启用", "warn"],
    skinned: ["ZCode 已连接 · 皮肤已启用", "ok"],
    busy: ["操作执行中…", "warn"],
  };
  let uiBusy = false;
  function setUiBusy(b) {
    uiBusy = b;
    ["#switch", "#enableBtn", "#applyBtn", "#restoreBtn", "#importBtn"].forEach(s => { $(s).disabled = b; });
  }
  async function refreshStatus() {
    if (uiBusy) return; // 操作期间不轮询，避免状态回跳
    const st = await window.zskin.getStatus();
    let [text, cls] = STATUS_TEXT[st.state] || STATUS_TEXT.idle;
    // D2：选择器健康告警（ZCode 升级后选择器可能失效）
    const health = st.selectorHealth;
    if (health && health.level && health.level !== "ok") {
      text += " · ⚠ " + health.message;
      cls = "warn";
    }
    const val = $("#statusVal");
    val.textContent = text;
    val.className = "value " + (cls === "off" ? "" : cls);
    $("#footDot").className = "dot " + cls;
    $("#footText").textContent = text;
    $("#switch").classList.toggle("on", st.state === "skinned");
    $("#switch").setAttribute("aria-checked", st.state === "skinned" ? "true" : "false");
    // 轮换等场景下 appliedId 变化时只移动「使用中」徽章，不再整屏重渲染
    if (st.appliedId !== undefined && st.appliedId !== state.appliedId) {
      state.appliedId = st.appliedId;
      document.querySelectorAll(".theme-card").forEach(card => {
        const t = state.themes.find(x => x.id === card.dataset.id);
        if (t) updateCard(card, t);
      });
    }
  }

  /* 轮询生命周期：窗口隐藏（含隐藏到托盘）时停表，恢复可见时立即刷新一次 */
  let statusTimer = null;
  function startStatusLoop() {
    if (statusTimer) return;
    statusTimer = setInterval(refreshStatus, 4000);
    refreshStatus();
  }
  function stopStatusLoop() {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopStatusLoop(); else startStatusLoop();
  });

  function setMsg(text, cls) {
    const m = $("#runMsg");
    m.textContent = text; m.className = cls || "";
  }

  async function busyEnable(btn) {
    setUiBusy(true);
    setMsg("正在启动 ZCode 并注入主题…");
    try {
      const r = await window.zskin.enableSkin();
      setMsg(r.message, r.ok ? "ok" : "err");
    } catch (e) {
      setMsg("启用失败：" + e.message, "err");
    } finally {
      setUiBusy(false);
      state = await window.zskin.getState();
      render();
      refreshStatus();
    }
  }

  $("#enableBtn").onclick = e => busyEnable(e.currentTarget);
  $("#applyBtn").onclick = e => busyEnable(e.currentTarget);
  $("#switch").onclick = async () => {
    const on = $("#switch").classList.contains("on");
    setUiBusy(true);
    try {
      if (on) {
        setMsg("正在恢复…");
        const r = await window.zskin.disableSkin();
        setMsg(r.message, r.ok ? "ok" : "err");
      } else {
        setMsg("正在启动 ZCode 并注入主题…");
        const r = await window.zskin.enableSkin();
        setMsg(r.message, r.ok ? "ok" : "err");
      }
    } catch (e) {
      setMsg("操作失败：" + e.message, "err");
    } finally {
      setUiBusy(false);
      state = await window.zskin.getState();
      render();
      refreshStatus();
    }
  };
  $("#restoreBtn").onclick = async () => {
    setUiBusy(true);
    setMsg("正在恢复…");
    try {
      const r = await window.zskin.disableSkin();
      setMsg(r.message, r.ok ? "ok" : "err");
    } catch (e) {
      setMsg("恢复失败：" + e.message, "err");
    } finally {
      setUiBusy(false);
      state = await window.zskin.getState();
      render();
      refreshStatus();
    }
  };
  $("#chooseZcodeBtn").onclick = async () => { state = await window.zskin.chooseZcode(); render(); };

  /* ---------- 主题参数（各分段按钮按功能分组绑定，不依赖覆盖顺序） ---------- */
  $("#alpha").oninput = e => { $("#alphaVal").textContent = fmtAlpha(e.target.value); };
  $("#alpha").onchange = async e => {
    const t = draftTheme();
    if (!t) return;
    state = await window.zskin.setThemeParams(t.id, Number(e.target.value) / 100);
  };
  $$("#draftParams .seg button").forEach(b => b.onclick = async () => {
    const t = draftTheme();
    if (!t) return;
    state = await window.zskin.setThemeParams(t.id, undefined, b.dataset.pos);
    renderDraftParams();
  });

  /* A1 滤镜滑块：拖动即时更新数值显示，松手（change）落盘并触发实时重注入 */
  const FILTERS = [["#fBlur", "#fBlurVal", "blur", v => v + "px"], ["#fBright", "#fBrightVal", "brightness", v => v + "%"], ["#fContrast", "#fContrastVal", "contrast", v => v + "%"], ["#fSatur", "#fSaturVal", "saturate", v => v + "%"]];
  for (const [input, label, key, fmt] of FILTERS) {
    $(input).oninput = e => { $(label).textContent = fmt(Number(e.target.value)); };
    $(input).onchange = async e => {
      const t = draftTheme();
      if (!t) return;
      const raw = Number(e.target.value);
      const val = key === "blur" ? raw : raw / 100;
      state = await window.zskin.setThemeParams(t.id, undefined, undefined, { [key]: val });
      renderFilterRow(draftTheme());
    };
  }
  /* A2 遮罩档位 */
  $$("#filterRow .seg button").forEach(b => b.onclick = async () => {
    const t = draftTheme();
    if (!t) return;
    state = await window.zskin.setThemeParams(t.id, undefined, undefined, { shade: Number(b.dataset.shade) });
    renderFilterRow(draftTheme());
  });

  /* C1/C3 启动偏好 */
  $("#autostartSwitch").onclick = async () => {
    state = await window.zskin.setRuntimePrefs({ autostart: !state.autostart });
    renderStartupRow();
    setMsg("开机自启" + (state.autostart ? "已开启（登录后驻留托盘）" : "已关闭"), "ok");
  };
  $("#autoApplySwitch").onclick = async () => {
    state = await window.zskin.setRuntimePrefs({ autoApply: !state.autoApply });
    renderStartupRow();
    setMsg("启动后自动应用上次主题" + (state.autoApply ? "已开启" : "已关闭"), "ok");
  };
  $("#hotkeySwitch").onclick = async () => {
    const enabled = !((state.hotkeys || {}).enabled);
    state = await window.zskin.setRuntimePrefs({ hotkeys: enabled });
    renderStartupRow();
    setMsg("全局快捷键" + (enabled ? "已开启（Alt+Shift+S / Alt+Shift+N）" : "已关闭"), "ok");
  };

  /* D1 连接自测向导 */
  $("#diagBtn").onclick = async () => {
    const btn = $("#diagBtn");
    const box = $("#diagResult");
    btn.disabled = true;
    box.style.display = "grid";
    box.innerHTML = `<div class="diag-step"><span class="mark">…</span><span class="ddetail">正在逐项检查（路径 → 进程 → 端口 → 目标 → 注入 → 选择器）…</span></div>`;
    try {
      const r = await window.zskin.runDiagnostics();
      if (!r.ok) { box.innerHTML = `<div class="diag-step fail"><span class="mark">✗</span><span class="ddetail">${r.message || "诊断失败"}</span></div>`; return; }
      box.innerHTML = r.steps.map(s => `
        <div class="diag-step ${s.ok ? "ok" : "fail"}">
          <span class="mark">${s.ok ? "✓" : "✗"}</span>
          <span class="dname">${s.name}</span>
          <span class="ddetail">${s.detail || ""}</span>
        </div>${s.hint ? `<div class="diag-hint">↳ ${s.hint}</div>` : ""}`).join("")
        + `<div class="diag-summary ${r.overall ? "" : "warn"}">${r.overall ? "✔ 链路整体健康" : "⚠ 链路存在断点，按上面 ✗ 项的提示处理"}</div>`;
    } catch (e) {
      box.innerHTML = `<div class="diag-step fail"><span class="mark">✗</span><span class="ddetail">诊断执行失败：${e.message}</span></div>`;
    } finally {
      btn.disabled = false;
    }
  };
  $$("#appearanceRow .seg button").forEach(b => b.onclick = async () => {
    state = await window.zskin.setAppearance(b.dataset.app);
    renderAppearance();
  });
  $("#rotSwitch").onclick = async () => {
    state = await window.zskin.setRotation({ enabled: !(state.rotation && state.rotation.enabled) });
    renderRotation();
  };
  $("#rotInterval").onchange = async e => {
    state = await window.zskin.setRotation({ intervalMin: Number(e.target.value) });
  };
  $$("#rotationRow .seg button").forEach(b => b.onclick = async () => {
    state = await window.zskin.setRotation({ order: b.dataset.order });
    renderRotation();
  });

  $("#zcodeVerCheckBtn").onclick = async () => {
    const btn = $("#zcodeVerCheckBtn");
    btn.disabled = true;
    $("#zcodeVerResult").textContent = "正在查询（官方更新源 → 开源仓库 Release）…";
    try {
      const r = await window.zskin.checkZcodeUpdate();
      $("#zcodeVerResult").textContent = r.message;
    } catch (e) {
      $("#zcodeVerResult").textContent = "检查失败：" + e.message;
    } finally { btn.disabled = false; }
  };
  $("#copyRepoBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText("https://github.com/zai-org/ZCode");
      $("#copyRepoBtn").textContent = "已复制";
      setTimeout(() => { $("#copyRepoBtn").textContent = "复制链接"; }, 1500);
    } catch {}
  };
  $("#openLogsBtn").onclick = async () => { await window.zskin.openLogs(); };

  $("#importBtn").onclick = async () => {
    setUiBusy(true);
    try {
      state = await window.zskin.importThemes();
      render();
      if (Array.isArray(state.imported) && state.imported.length) {
        setMsg("已导入：" + state.imported.join("、"), "ok");
      }
      if (state.draftId) applyAccent(await window.zskin.getAccent(state.draftId));
    } catch (e) {
      setMsg("导入失败：" + e.message, "err");
    } finally { setUiBusy(false); }
  };

  /* ---------- 启动 ---------- */
  (async () => {
    state = await window.zskin.getState();
    // 软件渲染模式（gpu-off.flag）下关闭 blur 合成，避免卡顿
    if (state.gpuOff) document.body.classList.add("no-blur");
    applyAccent(await window.zskin.getAccent(state.draftId));
    render();
    startStatusLoop();
  })();
