/* 部署辅助：把 app 根的运行时文件以硬链接形式挂到 dist-new 的 resources/app。
   为什么需要：对 main.js/preload.js/package.json 的 Edit/Write 是原子替换（新 inode），
   会静默断开旧硬链接，导致部署目录停留在旧代码。改动这些文件后请跑一次 `npm run deploy`。
   src/ 与 ui/ 是目录 junction，改动自动生效，无需处理。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(root, "dist-new", "ZCodeSkinLauncher-win32-x64", "resources", "app");
const FILES = ["main.js", "preload.js", "package.json", "gpu-off.flag"];

if (!fs.existsSync(path.join(dest, "tray.png"))) {
  console.error("部署目录不存在或结构不对:", dest);
  process.exit(1);
}

for (const f of FILES) {
  const src = path.join(root, f);
  const dst = path.join(dest, f);
  if (!fs.existsSync(src)) { console.error("源文件缺失:", src); process.exit(1); }
  try { fs.rmSync(dst); } catch {}
  try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
}
console.log("已部署(硬链接):", FILES.join(", "));
