/* CDP 层：端口探测 / 目标选择 / WebSocket / 带超时的 send */
const http = require("node:http");
const { WebSocket } = require("ws");

const PORT = 9222;
const CDP = `http://127.0.0.1:${PORT}`;

/* 所有 http.get 统一"timeout 监听 + destroy + resolve/reject"三件套，杜绝 Promise 永不 settle */
function cdpReachable() {
  return new Promise(resolve => {
    const req = http.get(`${CDP}/json/version`, { timeout: 900 }, r => { resolve(r.statusCode === 200); r.resume(); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitCdp(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await cdpReachable()) return true; await sleep(500); }
  return false;
}

function pickTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${CDP}/json/list`, { timeout: 2000 }, r => {
      let body = "";
      r.on("data", d => (body += d));
      r.on("end", () => {
        try {
          const list = JSON.parse(body);
          const pages = list.filter(t => t.type === "page" && !String(t.url).startsWith("devtools:"));
          resolve(pages.find(t => t.title === "ZCode") || pages[0] || null);
        } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("CDP /json/list 超时")); });
    req.on("error", reject);
  });
}

/* 启动后主窗口注册可能晚于端口就绪，轮询等待 */
async function waitTarget(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const t = await pickTarget(); if (t) return t; } catch {}
    await sleep(500);
  }
  return null;
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const to = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("WebSocket 连接超时")); }, 6000);
    ws.on("open", () => { clearTimeout(to); resolve(ws); });
    ws.on("error", () => { clearTimeout(to); reject(new Error("WebSocket 连接失败")); });
  });
}

let wsSeq = 0;

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++wsSeq;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMsg);
      ws.off("close", onDead);
      ws.off("error", onDead);
    };
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      err ? reject(err) : resolve(result);
    };
    // 每个请求 5 秒超时，防止渲染层无响应时未决请求堆积
    const timer = setTimeout(() =>
      finish(new Error(method + ": 响应超时（5 秒）")), 5000);
    const onMsg = raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.id === id) {
        msg.error
          ? finish(new Error(method + ": " + (msg.error ? msg.error.message : "unknown")))
          : finish(null, msg.result || {});
      }
    };
    // 连接断开时让未决请求立刻失败，避免 Promise 与监听器泄漏
    const onDead = () => finish(new Error(method + ": 连接已断开"));
    ws.on("message", onMsg);
    ws.on("close", onDead);
    ws.on("error", onDead);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const res = await cdpSend(ws, "Runtime.evaluate", { expression, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "evaluate 失败");
  return res.result?.value;
}

module.exports = { PORT, CDP, cdpReachable, sleep, waitCdp, pickTarget, waitTarget, connectWs, cdpSend, evaluate };
