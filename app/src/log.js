/* 统一诊断日志：写入 userData/diag.log，超过 512KB 截断保留后半 */
const fs = require("node:fs");
const path = require("node:path");

let logFile = null;

function initLog(userDataDir) {
  logFile = path.join(userDataDir, "diag.log");
}

function log(tag, msg) {
  const line = new Date().toISOString() + " [" + tag + "] " + msg;
  try {
    if (logFile) {
      try {
        const st = fs.statSync(logFile);
        if (st.size > 512 * 1024) {
          const old = fs.readFileSync(logFile, "utf8");
          fs.writeFileSync(logFile, old.slice(old.length >> 1));
        }
      } catch {}
      fs.appendFileSync(logFile, line + "\n");
    }
  } catch {}
  try { console.log(line); } catch {}
}

/* D3：读取日志尾部（默认 64KB）供页内查看；起点落在行中间时丢弃半行 */
function readTail(maxBytes = 64 * 1024) {
  if (!logFile) return { text: "", path: "", size: 0, missing: true };
  let size = 0;
  try { size = fs.statSync(logFile).size; }
  catch { return { text: "", path: logFile, size: 0, missing: true }; }
  try {
    const start = Math.max(0, size - maxBytes);
    let buf;
    if (start === 0) buf = fs.readFileSync(logFile);
    else {
      const fd = fs.openSync(logFile, "r");
      try {
        buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
      } finally { fs.closeSync(fd); }
    }
    let text = buf.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    return { text, path: logFile, size, missing: false };
  } catch (e) {
    return { text: "", path: logFile, size, missing: true, error: e.message };
  }
}

module.exports = { initLog, log, readTail };
