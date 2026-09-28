/* DreamSkin.cc 社区主题：链接解析、固定 API 只读下载、完整性校验、导入 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { app } = require("electron");
const { log } = require("./log");
const { importThemePack } = require("./theme-pack");

/* 与上游客户端一致的约定：ID 形如 ver_ + 8~64 位小写字母数字（区分大小写）。
   网络访问只允许固定官方 API（https + 精确 host + 精确路径），拒绝重定向；
   包大小与 SHA-256 以元数据登记值为准做字节级比对 */
const VER_ID_RE = /^ver_[a-z0-9]{8,64}$/;
const GALLERY_URL = "https://dreamskin.cc/gallery";
const API_ORIGIN = "https://api.dreamskin.cc";
const API_PATH_RE = /^\/v1\/themes\/(ver_[a-z0-9]{8,64})(\/download)?$/;
const UA = "zcode-skin-launcher";
const MAX_META = 64 * 1024;        // 上游客户端同款 64KiB 元数据上限
const MAX_PACK = 32 * 1024 * 1024; // 上游包契约：单包 ≤ 32MiB
const META_TIMEOUT = 12000;
const DOWNLOAD_TIMEOUT = 30000;

/* 接受三种输入：dreamskin://apply?version=ver_x 一键换肤链接、含 ver_ 的主题库链接、裸 ver_ ID */
function parseCommunityRef(input) {
  const m = String(input || "").match(/ver_[a-z0-9]{8,64}/);
  return m ? m[0] : null;
}

/* 出口统一校验：协议、host、路径必须精确匹配固定 API（顺带拒绝 IP 字面量与凭据内嵌） */
function assertApiUri(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error("内部错误：下载地址无效"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.hostname !== "api.dreamskin.cc" || !API_PATH_RE.test(url.pathname)) {
    throw new Error("下载地址不在固定白名单内，已中止");
  }
  return url;
}

/* 打开一个已通过安全检查的 200 响应流；3xx 一律拒绝（与上游客户端同款禁重定向策略）。
   超时是套接字空闲超时：进入传输阶段后由消费方 res.on("error") 收尾 */
function openSafe(uri, timeoutMs) {
  const url = assertApiUri(uri);
  return new Promise((resolve, reject) => {
    let resRef = null;
    const req = https.get(url, { timeout: timeoutMs, headers: { "User-Agent": UA, "Accept": "*/*" } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400) {
        r.resume();
        reject(new Error("下载源尝试重定向，已按安全策略中止"));
        req.destroy();
        return;
      }
      if (r.statusCode !== 200) {
        r.resume();
        const code = r.statusCode;
        reject(new Error(
          code === 404 ? "主题不存在或已下架（404）" :
          code === 403 ? "访问被社区服务器拒绝（403），请稍后再试" :
          `下载失败（HTTP ${code}）`));
        return;
      }
      resRef = r;
      resolve(r);
    });
    req.on("error", e => reject(new Error("网络错误：" + e.message)));
    req.on("timeout", () => {
      const err = new Error("连接超时，请检查网络后重试");
      if (resRef) resRef.destroy(err);
      else { try { req.destroy(err); } catch {} reject(err); }
    });
  });
}

/* 元数据：Content-Type 必须 JSON、64KiB 双重上限、必须带登记大小与 SHA-256（上游契约字段） */
async function fetchMeta(verId) {
  const res = await openSafe(`${API_ORIGIN}/v1/themes/${verId}`, META_TIMEOUT);
  return new Promise((resolve, reject) => {
    const ct = String(res.headers["content-type"] || "");
    const cl = Number(res.headers["content-length"]);
    if (!ct.includes("application/json")) { res.destroy(); return reject(new Error("主题信息返回格式异常（非 JSON）")); }
    if (Number.isFinite(cl) && cl >= 0 && cl > MAX_META) { res.destroy(); return reject(new Error("主题信息异常偏大，已中止")); }
    const chunks = []; let n = 0;
    res.on("data", d => {
      n += d.length;
      if (n > MAX_META) { res.destroy(); return reject(new Error("主题信息异常偏大，已中止")); }
      chunks.push(d);
    });
    res.on("error", e => reject(new Error("网络错误：" + e.message)));
    res.on("end", () => {
      let raw;
      try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return reject(new Error("主题信息解析失败")); }
      const name = typeof raw.Name === "string" ? raw.Name.trim() : "";
      const bytes = Number(raw.PackageBytes);
      const sha = typeof raw.PackageSha256 === "string" ? raw.PackageSha256.toLowerCase() : "";
      if (!name || !Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_PACK || !/^[0-9a-f]{64}$/.test(sha)) {
        return reject(new Error("主题信息缺少必要的完整性字段（大小/SHA-256），已拒绝导入"));
      }
      resolve({
        name: name.slice(0, 40),
        author: typeof raw.AuthorDisplayName === "string" ? raw.AuthorDisplayName.trim().slice(0, 40) : "",
        version: String(raw.Version || "").slice(0, 20),
        bytes,
        sha256: sha,
      });
    });
  });
}

/* 包体流式下载：Content-Type 必须 zip、Content-Length/累计字节必须精确等于登记值、
   边下边算 SHA-256，任何不符即删临时文件并中止 */
function downloadPack(verId, meta, destPath, onProgress) {
  return openSafe(`${API_ORIGIN}/v1/themes/${verId}/download`, DOWNLOAD_TIMEOUT).then(res => new Promise((resolve, reject) => {
    const ct = String(res.headers["content-type"] || "");
    if (!ct.includes("application/zip") && !ct.includes("application/octet-stream")) {
      res.destroy();
      return reject(new Error("下载内容不是主题包"));
    }
    const cl = Number(res.headers["content-length"]);
    if (Number.isFinite(cl) && cl >= 0 && cl !== meta.bytes) {
      res.destroy();
      return reject(new Error("主题包大小与登记信息不符，已中止"));
    }
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(destPath);
    let received = 0, failed = false;
    const fail = e => {
      if (failed) return;
      failed = true;
      try { res.destroy(); } catch {}
      try { out.destroy(); } catch {}
      fs.unlink(destPath, () => {});
      reject(e);
    };
    res.on("data", d => {
      if (failed) return;
      received += d.length;
      if (received > meta.bytes) { fail(new Error("主题包超出登记大小，已中止")); return; }
      hash.update(d);
      if (!out.write(d)) { res.pause(); out.once("drain", () => res.resume()); }
      if (onProgress) { try { onProgress(received); } catch {} }
    });
    res.on("error", e => fail(new Error("下载中断：" + e.message)));
    out.on("error", e => fail(new Error("写入临时文件失败：" + e.message)));
    res.on("end", () => {
      if (failed) return;
      out.end(() => {
        try {
          if (received !== meta.bytes) throw new Error("主题包字节数与登记信息不符，已中止");
          if (hash.digest("hex") !== meta.sha256) throw new Error("SHA-256 校验不符，已丢弃下载内容");
          resolve({ bytes: received });
        } catch (e) {
          fs.unlink(destPath, () => {});
          reject(e);
        }
      });
    });
  }));
}

/* 完整安装链：解析 → 元数据 → 下载校验 → 复用现有 importThemePack 解析 → 打社区来源标记。
   临时 zip 在 finally 里清理；进度经 onStage 回调推给渲染层 */
async function installCommunityPack(ref, onStage) {
  const verId = parseCommunityRef(ref);
  if (!verId) throw new Error("无法识别主题 ID：请粘贴 ver_ 开头的主题 ID、主题页链接或 dreamskin:// 一键换肤链接");
  const stage = p => { if (onStage) { try { onStage(p); } catch {} } };

  stage({ stage: "meta", message: "获取主题信息…" });
  const meta = await fetchMeta(verId);

  const tmpDir = path.join(app.getPath("userData"), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpZip = path.join(tmpDir, `community-${verId}-${Date.now()}.zip`);
  try {
    stage({ stage: "download", message: `下载「${meta.name}」…`, received: 0, total: meta.bytes });
    await downloadPack(verId, meta, tmpZip, received => {
      stage({ stage: "download", received, total: meta.bytes, message: "下载中…" });
    });
    stage({ stage: "verify", message: "校验完整性（大小 / SHA-256）…" });
    stage({ stage: "import", message: "导入主题包…" });
    const theme = importThemePack(tmpZip);
    theme.community = {
      verId,
      name: meta.name,
      author: meta.author,
      version: meta.version,
      bytes: meta.bytes,
      importedAt: new Date().toISOString(),
    };
    log("community", `社区主题导入成功「${meta.name}」(${verId}，${meta.bytes} 字节)`);
    return { theme, meta };
  } finally {
    try { fs.unlinkSync(tmpZip); } catch {}
  }
}

module.exports = { parseCommunityRef, installCommunityPack, GALLERY_URL };
