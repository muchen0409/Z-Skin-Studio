import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packager = require("@electron/packager");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从本机 electron 包读实际版本，再到官方缓存目录定位已下载的 zip（离线打包，不联网）
const electronPkg = require(path.join(__dirname, "node_modules", "electron", "package.json"));
const version = electronPkg.version;
const cacheRoot = path.join(process.env.LOCALAPPDATA || "", "electron", "Cache");
let zipDir = null;
if (fs.existsSync(cacheRoot)) {
  for (const d of fs.readdirSync(cacheRoot)) {
    const candidate = path.join(cacheRoot, d, `electron-v${version}-win32-x64.zip`);
    if (fs.existsSync(candidate)) { zipDir = path.dirname(candidate); break; }
  }
}
if (!zipDir) {
  console.error(`缓存里没有 electron-v${version}-win32-x64.zip，请先跑一次 npm install 让 electron postinstall 下载`);
  process.exit(1);
}

// 产物统一输出 dist-new（与 README 一致）；ignore 掉产物目录自身与旧 dist，避免嵌套打包
const paths = await packager.default({
  dir: __dirname,
  out: "dist-new",
  name: "ZCodeSkinLauncher",
  platform: "win32",
  arch: "x64",
  overwrite: true,
  electronZipDir: zipDir,
  ignore: [
    /^\/dist($|\/)/,
    /^\/dist-new($|\/)/,
    /^\/build\.mjs$/,
    /^\/_map\.js$/,
    /^\/package-lock\.json$/,
    /^\/\.gitignore$/,
    /^\/node_modules\/@electron($|\/)/,
    /^\/node_modules\/@malept($|\/)/,
    /^\/node_modules\/@types($|\/)/,
  ],
});
console.log("打包完成:", paths.join(", "));
