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

module.exports = { initLog, log };
