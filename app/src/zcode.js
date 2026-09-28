/* ZCode 客户端相关：进程探活、路径查找、asar 版本读取、更新检查 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { spawn } = require("node:child_process");
const config = require("./config");
const { state } = require("./state");
const { log } = require("./log");

const ZCODE_REPO_API = "https://api.github.com/repos/zai-org/ZCode/releases/latest";
const ZCODE_REPO_URL = "https://github.com/zai-org/ZCode";

/* 纯本地版本比较：剥离 v 前缀 → 逐段比较；数字段 > 非数字段（semver 预发布优先级更低）；
   任何异常输入都返回数值，不抛异常 */
function cmpVersion(a, b) {
  try {
    const norm = v => String(v || "").replace(/^[vV]/, "").split(/[.+-]/)
      .filter(p => p !== "").map(p => /^\d+$/.test(p) ? Number(p) : p);
    const pa = norm(a), pb = norm(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i], y = pb[i];
      if (x === undefined) return typeof y === "number" ? -1 : 1;
      if (y === undefined) return typeof x === "number" ? 1 : -1;
      if (x === y) continue;
      const xn = typeof x === "number", yn = typeof y === "number";
      if (xn && yn) return x < y ? -1 : 1;
      if (xn !== yn) return xn ? -1 : 1;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  } catch { return 0; }
}

/* 优先用 spawn 时记录的 pid 探活（零进程开销）；无记录（用户自行启动的 ZCode）
   才回退 tasklist 全量列举——不用 /fi 参数，规避 MSYS 环境的路径转换破坏，
   并加 3 秒超时与 10 秒结果缓存 */
let tasklistCache = { at: 0, running: false };

function zcodeRunning() {
  if (state.zcodePid) {
    try { process.kill(state.zcodePid, 0); return Promise.resolve(true); }
    catch (e) {
      if (e.code === "ESRCH") state.zcodePid = null;
      else log("probe", "pid 探活异常: " + e.code);
    }
  }
  if (Date.now() - tasklistCache.at < 10000) return Promise.resolve(tasklistCache.running);
  return new Promise(resolve => {
    const p = spawn("tasklist", ["/fo", "csv", "/nh"],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "", done = false;
    const finish = v => {
      if (done) return;
      done = true;
      tasklistCache = { at: Date.now(), running: v };
      resolve(v);
    };
    const to = setTimeout(() => { try { p.kill(); } catch {} finish(false); }, 3000);
    p.stdout.on("data", d => (out += d));
    p.on("error", e => { clearTimeout(to); log("probe", "tasklist 失败: " + e.message); finish(false); });
    p.on("close", () => { clearTimeout(to); finish(/ZCode\.exe/i.test(out)); });
  });
}

/* 从 app.asar 头部解析 package.json 的 version（asar 磁盘格式：8+header pickle） */
function readAsarPackageVersion(asarPath) {
  // Electron 会拦截 .asar 路径的 fs 调用，读取归档本身时需临时禁用
  process.noAsar = true;
  const fd = fs.openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4);
    const jsonPayloadLen = head.readUInt32LE(8); // 含 4 字节字符串长度前缀
    if (jsonPayloadLen <= 4 || jsonPayloadLen > 50 * 1024 * 1024) throw new Error("asar 头异常");
    const jsonBuf = Buffer.alloc(jsonPayloadLen);
    fs.readSync(fd, jsonBuf, 0, jsonPayloadLen, 12);
    // JSON 边界以偏移 12 处的字符串长度前缀为准（[8-11] 的 payload 长度含对齐填充，多读会导致解析失败）
    const jsonSize = jsonBuf.readUInt32LE(0);
    const header = JSON.parse(jsonBuf.toString("utf8", 4, 4 + jsonSize));
    const entry = header.files && header.files["package.json"];
    if (!entry) throw new Error("asar 内没有 package.json");
    const base = 8 + headerPickleSize;
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, base + Number(entry.offset));
    return String(JSON.parse(buf.toString("utf8")).version || "") || null;
  } finally { process.noAsar = false; fs.closeSync(fd); }
}

function getZcodeInfo() {
  const exe = config.get().zcodeExe || config.findZcodeExe();
  if (!exe || !fs.existsSync(exe)) return null;
  let version = null;
  try { version = readAsarPackageVersion(path.join(path.dirname(exe), "resources", "app.asar")); } catch (e) {
    log("zcode", "asar 版本读取失败: " + e.message);
  }
  return { exe, version };
}

/* 版本缓存：诊断/告警需要频繁比对版本，asar 读取只在进程内做一次 */
let cachedVersion;
function getCachedZcodeVersion() {
  if (cachedVersion === undefined) {
    const info = getZcodeInfo();
    cachedVersion = info ? info.version : null;
  }
  return cachedVersion;
}

/* 开源仓库 Release 兜底源：客户端自带更新源不可达时，从 GitHub 查询最新发布版本 */
function checkGithubRelease(current, officialFeed) {
  return new Promise(resolve => {
    const req = https.get(ZCODE_REPO_API, {
      timeout: 6000,
      headers: {
        "User-Agent": "zcode-skin-launcher",
        "Accept": "application/vnd.github+json",
      },
    }, r => {
      let body = ""; r.on("data", d => (body += d));
      r.on("end", () => {
        if (r.statusCode === 404) {
          resolve({ ok: true, current, source: "github", repo: ZCODE_REPO_URL,
            message: "开源仓库（github.com/zai-org/ZCode）尚未发布任何 Release，暂无法在线检查更新。" });
          return;
        }
        if (r.statusCode === 403) {
          resolve({ ok: true, current, source: "github",
            message: "GitHub API 访问受限（匿名限额 60 次/小时），请稍后再试。" });
          return;
        }
        if (r.statusCode !== 200) {
          resolve({ ok: true, current, source: "github", message: `GitHub 查询失败（HTTP ${r.statusCode}）。` });
          return;
        }
        try {
          const rel = JSON.parse(body);
          const tag = rel.tag_name || rel.name || "";
          const clean = tag.replace(/^v/i, "");
          const result = { ok: true, current, latest: clean, feed: officialFeed, source: "github", repo: rel.html_url || ZCODE_REPO_URL };
          if (!current || cmpVersion(current, clean) === 0) {
            result.message = `ZCode 已是最新版本（v${current}，与开源仓库 ${tag} 一致）。`;
          } else if (cmpVersion(current, clean) > 0) {
            result.message = `当前客户端 v${current} 比开源仓库最新 Release ${tag} 更新（官方可能尚未发版）。`;
          } else {
            result.message = `发现新版本 ${tag}（当前 v${current}），请通过 ZCode 客户端更新。`;
          }
          resolve(result);
        } catch (e) {
          resolve({ ok: true, current, source: "github", message: "GitHub 响应解析失败：" + e.message });
        }
      });
    });
    req.on("error", () => resolve({ ok: true, current, source: "github",
      message: "无法访问 GitHub。ZCode 的版本更新由其客户端自行管理。" }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: true, current, source: "github",
      message: "访问 GitHub 超时。ZCode 的版本更新由其客户端自行管理。" }); });
  });
}

/* 检查 ZCode 更新：读取 ZCode 自带的 app-update.yml 更新源并拉取 latest.yml */
async function checkZcodeUpdate() {
  const info = getZcodeInfo();
  if (!info) return { ok: false, message: "未找到 ZCode.exe，无法检查。" };
  const current = info.version;

  const ymlPath = path.join(path.dirname(info.exe), "resources", "app-update.yml");
  let feed = null;
  try {
    const yml = fs.readFileSync(ymlPath, "utf8");
    const m = yml.match(/url:\s*(\S+)/);
    if (m) feed = m[1];
  } catch (e) { log("update", "app-update.yml 读取失败: " + e.message); }

  if (!feed) {
    return { ok: true, current, message: "ZCode 未配置更新源，请通过 ZCode 客户端自带方式检查更新。" };
  }

  // electron-updater generic 源的版本清单是 {feed}/latest.yml
  const latest = await new Promise(resolve => {
    const clean = feed.replace(/\/$/, "");
    const mod = clean.startsWith("https:") ? https : http;
    const req = mod.get(clean + "/latest.yml", { timeout: 5000 }, r => {
      let body = ""; r.on("data", d => (body += d)); r.on("end", () => resolve(body));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });

  if (!latest) {
    return await checkGithubRelease(current, feed);
  }
  const mv = latest.match(/version:\s*([^\s]+)/);
  const latestVer = mv && mv[1];
  if (!latestVer) return { ok: true, current, feed, source: "official", message: "更新源响应无法解析。" };

  const upToDate = current ? cmpVersion(current, latestVer) >= 0 : false;
  return {
    ok: true, current, latest: latestVer, feed, upToDate, source: "official",
    message: upToDate
      ? `ZCode 已是最新版本（v${current}）。`
      : `发现新版本 v${latestVer}（当前 v${current}），请通过 ZCode 客户端更新。`,
  };
}

module.exports = { cmpVersion, zcodeRunning, readAsarPackageVersion, getZcodeInfo, getCachedZcodeVersion, checkZcodeUpdate, ZCODE_REPO_URL };
