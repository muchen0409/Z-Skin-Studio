/* Zcode+ 管理控制台 — 渲染层逻辑（经 preload 暴露的 window.zskin 与主进程通信） */
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let state = null;

  const ICONS = {
    rename: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
    download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  };

  function applyAccent(rgb) {
    if (!Array.isArray(rgb)) return;
    const [r, g, b] = rgb;
    const root = document.documentElement.style;
    root.setProperty("--accent", `rgb(${r},${g},${b})`);
    root.setProperty("--accent-soft", `rgba(${r},${g},${b},.18)`);
    root.setProperty("--accent-deep", `rgb(${Math.round(r*.72)},${Math.round(g*.72)},${Math.round(b*.72)})`);
  }

  function fmtAlpha(v) { return Math.round(v) + "%"; }

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
        const tip = document.createElement("div");
        tip.textContent = "还没有主题 —— 把图片或主题包拖进窗口，或点击下面的按钮导入";
        const go = document.createElement("button");
        go.className = "btn ghost";
        go.textContent = "导入主题";
        go.onclick = () => $("#importBtn").click();
        empty.append(tip, go);
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
  const pages = { skin: $("#pageSkin"), community: $("#pageCommunity"), version: $("#pageVersion") };
  $$(".nav-item").forEach(b => b.onclick = () => {
    $$(".nav-item").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    for (const [key, el] of Object.entries(pages)) el.style.display = key === b.dataset.page ? "" : "none";
    if (b.dataset.page === "version") renderVersionPage();
    if (b.dataset.page === "community") renderCommunityList();
    if (b.dataset.page === "skin") render();
  });

  function draftTheme() {
    // state 未就绪（启动窗口期 getState 尚未返回）时安全返回 null，handler 会走 !t 分支
    return state ? (state.themes.find(t => t.id === state.draftId) || null) : null;
  }

  function renderDraftParams() {
    const t = draftTheme();
    const box = $("#draftParams");
    if (!t) { box.style.display = "none"; renderFilterRow(null); renderZoneRow(null); return; }
    box.style.display = "flex";
    $("#alpha").value = Math.round(t.alpha * 100);
    $("#alphaVal").textContent = fmtAlpha(Math.round(t.alpha * 100));
    // 只收窄到草稿参数区，避免清掉深浅色/轮换顺序的分段高亮
    $$("#draftParams .seg button").forEach(b => b.classList.toggle("on", b.dataset.pos === t.position));
    renderFilterRow(t);
    renderZoneRow(t);
  }

  /* A3 分区透明度：null = 跟随全局，显示上以「%·全局」标注 */
  const ZONES = [
    ["main", "#zMain", "#zMainVal"],
    ["sidebar", "#zSidebar", "#zSidebarVal"],
    ["composer", "#zComposer", "#zComposerVal"],
    ["dialog", "#zDialog", "#zDialogVal"],
  ];
  function renderZoneRow(t) {
    const row = $("#zoneRow");
    if (!t) { row.style.display = "none"; return; }
    row.style.display = "flex";
    const g = Math.round((t.alpha || 0.1) * 100);
    for (const [key, input, val] of ZONES) {
      const zv = t.zoneAlpha && typeof t.zoneAlpha[key] === "number" ? Math.round(t.zoneAlpha[key] * 100) : null;
      $(input).value = zv ?? g;
      $(val).textContent = (zv ?? g) + "%" + (zv === null ? "·全局" : "");
    }
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
    const exp = document.createElement("button");
    exp.innerHTML = ICONS.download + "导出主题包";
    exp.onclick = async () => {
      closeMenu();
      setUiBusy(true);
      try {
        const r = await window.zskin.exportTheme(t.id);
        if (r && r.ok) setMsg(`已导出「${t.name}」主题包 → ${r.path}`, "ok");
        else if (r && !r.canceled && r.message) setMsg("导出失败：" + r.message, "err");
      } catch (e) {
        setMsg("导出失败：" + e.message, "err");
      } finally { setUiBusy(false); }
    };
    const del = document.createElement("button");
    del.className = "danger";
    del.innerHTML = ICONS.trash + "删除";
    del.onclick = async () => {
      closeMenu();
      // 删除会永久移除背景图文件，必须显式确认
      if (!(await askConfirm(`删除「${t.name}」？`, "主题的背景图文件将被永久删除，此操作无法撤销。", "删除", true))) return;
      state = await window.zskin.removeTheme(t.id);
      render();
    };
    m.append(rename, rot, exp, del);
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

  /* ---------- 通用确认模态框（危险操作统一走这里，替代原生 confirm） ----------
     返回 Promise<boolean>；danger=true 时确认键为红色警示样式 */
  function askConfirm(title, text, okLabel = "确认", danger = false) {
    return new Promise(resolve => {
      const mask = $("#confirmMask"), ok = $("#confirmOk");
      $("#confirmTitle").textContent = title;
      $("#confirmText").textContent = text;
      ok.textContent = okLabel;
      ok.classList.toggle("danger", danger);
      mask.classList.add("open");
      ok.focus();
      const done = v => {
        mask.classList.remove("open");
        ok.removeEventListener("click", onOk);
        $("#confirmCancel").removeEventListener("click", onCancel);
        mask.removeEventListener("click", onMask);
        document.removeEventListener("keydown", onKey, true);
        resolve(v);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onMask = e => { if (e.target === mask) done(false); };
      const onKey = e => {
        if (e.key === "Escape") done(false);
        else if (e.key === "Enter") { e.stopPropagation(); done(true); }
      };
      ok.addEventListener("click", onOk);
      $("#confirmCancel").addEventListener("click", onCancel);
      mask.addEventListener("click", onMask);
      document.addEventListener("keydown", onKey, true);
    });
  }

  /* ---------- 运行状态 ---------- */
  const STATUS_TEXT = {
    idle: ["ZCode 未运行或不可连接", "off"],
    "running-no-port": ["ZCode 运行中，但未开启调试端口", "warn"],
    connected: ["ZCode 已连接 · 皮肤未启用", "warn"],
    skinned: ["ZCode 已连接 · 皮肤已启用", "ok"],
    busy: ["操作执行中…", "warn"],
  };
  let uiBusyDepth = 0;
  /* 计数式：嵌套调用（如菜单导出包住外层操作）不会提前解锁 */
  function setUiBusy(b) {
    uiBusyDepth = Math.max(0, uiBusyDepth + (b ? 1 : -1));
    const busy = uiBusyDepth > 0;
    uiBusy = busy;
    ["#switch", "#enableBtn", "#applyBtn", "#restoreBtn", "#importBtn", "#communityInstallBtn", "#backupExportBtn", "#backupRestoreBtn"].forEach(s => { const el = $(s); if (el) el.disabled = busy; });
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
    if (btn) btn.classList.add("loading");
    setMsg("正在启动 ZCode 并注入主题…");
    try {
      const r = await window.zskin.enableSkin();
      setMsg(r.message, r.ok ? "ok" : "err");
    } catch (e) {
      setMsg("启用失败：" + e.message, "err");
    } finally {
      if (btn) btn.classList.remove("loading");
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
    const btn = $("#restoreBtn");
    setUiBusy(true);
    btn.classList.add("loading");
    setMsg("正在恢复…");
    try {
      const r = await window.zskin.disableSkin();
      setMsg(r.message, r.ok ? "ok" : "err");
    } catch (e) {
      setMsg("恢复失败：" + e.message, "err");
    } finally {
      btn.classList.remove("loading");
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

  /* A3 分区透明度：拖动落盘单分区，重置按钮全部回到跟随全局 */
  for (const [key, input, val] of ZONES) {
    $(input).oninput = e => { $(val).textContent = e.target.value + "%"; };
    $(input).onchange = async e => {
      const t = draftTheme();
      if (!t) return;
      state = await window.zskin.setThemeParams(t.id, undefined, undefined, { zoneAlpha: { [key]: Number(e.target.value) / 100 } });
      renderZoneRow(draftTheme());
    };
  }
  $("#zoneResetBtn").onclick = async () => {
    const t = draftTheme();
    if (!t) return;
    state = await window.zskin.setThemeParams(t.id, undefined, undefined, { zoneAlpha: { main: null, sidebar: null, composer: null, dialog: null } });
    renderZoneRow(draftTheme());
    setMsg("分区透明度已全部恢复为跟随全局", "ok");
  };

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

  /* D3 页内日志查看：尾部 64KB + 关键字过滤 + 复制 */
  async function loadLogs() {
    const r = await window.zskin.getLogs();
    const kw = $("#logFilter").value.trim();
    let text = (r && r.text) || "";
    if (kw) text = text.split("\n").filter(l => l.includes(kw)).join("\n");
    $("#logView").textContent = text.trim() ? text : (kw ? "(无匹配行)" : "(日志为空)");
  }
  $("#logViewBtn").onclick = async () => {
    const show = $("#logView").style.display !== "block";
    $("#logViewBtn").textContent = show ? "收起日志" : "查看日志";
    if (show) {
      $("#logFilter").style.display = "";
      $("#logRefreshBtn").style.display = "";
      $("#logCopyBtn").style.display = "";
      await loadLogs();
    }
    $("#logView").style.display = show ? "block" : "none";
  };
  $("#logRefreshBtn").onclick = () => loadLogs();
  $("#logFilter").onkeydown = e => { if (e.key === "Enter") loadLogs(); };
  $("#logCopyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("#logView").textContent);
      $("#logCopyBtn").textContent = "已复制";
      setTimeout(() => { $("#logCopyBtn").textContent = "复制"; }, 1500);
    } catch {}
  };

  /* B2/D4 备份与迁移（版本管理页） */
  $("#backupExportBtn").onclick = async () => {
    const btn = $("#backupExportBtn");
    btn.disabled = true;
    btn.classList.add("loading");
    $("#backupMsg").textContent = "正在打包主题库…";
    try {
      const r = await window.zskin.backupExport();
      $("#backupMsg").textContent = r.ok ? "已导出：" + r.path : (r.canceled ? "" : "导出失败：" + r.message);
    } catch (e) {
      $("#backupMsg").textContent = "导出失败：" + e.message;
    } finally { btn.disabled = false; btn.classList.remove("loading"); }
  };
  $("#backupRestoreBtn").onclick = async () => {
    if (!(await askConfirm("导入备份？", "将整体替换当前主题库与配置；替换前当前配置会自动留档（config.json.pre-restore）。", "导入备份"))) return;
    const btn = $("#backupRestoreBtn");
    btn.disabled = true;
    btn.classList.add("loading");
    $("#backupMsg").textContent = "正在从备份恢复…";
    try {
      const r = await window.zskin.backupRestore();
      if (r.ok) {
        state = r.state;
        render();
        applyAccent(await window.zskin.getAccent(state.draftId));
        $("#backupMsg").textContent = "已从备份恢复主题库与配置";
      } else if (!r.canceled) {
        $("#backupMsg").textContent = "恢复失败：" + r.message;
      } else {
        $("#backupMsg").textContent = "";
      }
    } catch (e) {
      $("#backupMsg").textContent = "恢复失败：" + e.message;
    } finally { btn.disabled = false; btn.classList.remove("loading"); }
  };

  $("#importBtn").onclick = async () => {
    setUiBusy(true);
    $("#importBtn").classList.add("loading");
    try {
      state = await window.zskin.importThemes();
      render();
      if (Array.isArray(state.imported) && state.imported.length) {
        setMsg("已导入：" + state.imported.join("、"), "ok");
      }
      if (state.draftId) applyAccent(await window.zskin.getAccent(state.draftId));
    } catch (e) {
      setMsg("导入失败：" + e.message, "err");
    } finally {
      $("#importBtn").classList.remove("loading");
      setUiBusy(false);
    }
  };

  /* 拖拽导入：图片 / 主题包 zip 直接拖进窗口（Electron 32+ 移除 File.path，
     路径经 preload 的 webUtils.getPathForFile 换取） */
  let dragDepth = 0;
  window.addEventListener("dragenter", e => {
    e.preventDefault();
    if (++dragDepth === 1) $("#grid").classList.add("drag-over");
  });
  window.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  window.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) { dragDepth = 0; $("#grid").classList.remove("drag-over"); }
  });
  window.addEventListener("drop", async e => {
    e.preventDefault();
    dragDepth = 0;
    $("#grid").classList.remove("drag-over");
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    setUiBusy(true);
    setMsg("正在导入拖入的文件…");
    try {
      const paths = files.map(f => { try { return window.zskin.filePath(f) || ""; } catch { return ""; } }).filter(Boolean);
      if (!paths.length) { setMsg("拖入的文件无法读取路径", "err"); return; }
      state = await window.zskin.importPaths(paths);
      render();
      if (Array.isArray(state.imported) && state.imported.length) {
        setMsg("已导入：" + state.imported.join("、"), "ok");
        if (state.draftId) applyAccent(await window.zskin.getAccent(state.draftId));
      }
    } catch (err) {
      setMsg("导入失败：" + err.message, "err");
    } finally { setUiBusy(false); }
  });

  /* ---------- 社区主题（DreamSkin.cc 固定 API，主进程下载校验） ---------- */
  function setCommunityStatus(text, cls) {
    const el = $("#communityStatus");
    el.style.display = "block";
    el.textContent = text;
    el.className = cls || "";
  }

  function renderCommunityList() {
    const box = $("#communityList");
    box.innerHTML = "";
    const items = (state.themes || []).filter(t => t.community);
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "community-empty";
      empty.textContent = "还没有从社区导入的主题 —— 上面粘贴 ver_ ID 即可开始";
      box.append(empty);
      return;
    }
    for (const t of items) {
      const row = document.createElement("div");
      row.className = "community-row";
      const info = document.createElement("div");
      info.className = "cinfo";
      const nm = document.createElement("span");
      nm.className = "cname";
      nm.textContent = t.name;
      const sub = document.createElement("span");
      sub.className = "csub";
      sub.textContent = [t.community.author ? "by " + t.community.author : "", t.community.verId].filter(Boolean).join(" · ");
      info.append(nm, sub);
      const view = document.createElement("button");
      view.className = "btn ghost";
      view.style.padding = "4px 14px";
      view.style.fontSize = "12px";
      view.textContent = "查看";
      view.onclick = () => {
        $("#navSkin").click();
        selectTheme(t.id);
      };
      row.append(info, view);
      box.append(row);
    }
  }

  /* 下载阶段进度：主进程 community-progress 事件实时推送 */
  window.zskin.onCommunityProgress(p => {
    if (!p) return;
    if (p.stage === "download" && p.total) {
      const pct = Math.min(100, Math.round((p.received / p.total) * 100));
      setCommunityStatus(`下载中 ${pct}%（${(p.received / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB）`, "");
    } else if (p.message) {
      setCommunityStatus(p.message, "");
    }
  });

  $("#openGalleryBtn").onclick = async () => { await window.zskin.openCommunityGallery(); };
  $("#communityInput").onkeydown = e => { if (e.key === "Enter") $("#communityInstallBtn").click(); };
  $("#communityInstallBtn").onclick = async () => {
    const ref = $("#communityInput").value.trim();
    if (!ref) { setCommunityStatus("请先粘贴 ver_ 主题 ID 或链接", "err"); return; }
    setUiBusy(true);
    $("#communityInstallBtn").classList.add("loading");
    setCommunityStatus("解析链接…", "");
    try {
      const r = await window.zskin.installCommunity(ref);
      if (r && r.ok) {
        state = r.state;
        render();
        renderCommunityList();
        $("#communityInput").value = "";
        setCommunityStatus(`已导入「${r.theme.name}」，可在「皮肤管理 · 我的主题」中使用`, "ok");
      } else {
        setCommunityStatus((r && r.message) || "导入失败", "err");
      }
    } catch (e) {
      setCommunityStatus("导入失败：" + e.message, "err");
    } finally {
      $("#communityInstallBtn").classList.remove("loading");
      setUiBusy(false);
    }
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
