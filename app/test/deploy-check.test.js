/* 部署一致性校验：dist-new 下被硬链接的根文件必须与源码字节一致。
   根因背景：Edit/Write 对文件是原子替换（新 inode），会静默断开硬链接，
   部署目录停留旧代码（v2.1.0 滤镜滑块"修了还坏"的真因）。
   本测试不防断链本身，但把"生产跑旧代码"从静默事故变成显式红灯。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");
const DEST = path.resolve(APP_ROOT, "dist-new", "ZCodeSkinLauncher-win32-x64", "resources", "app");
const FILES = ["main.js", "preload.js", "package.json", "gpu-off.flag"]; // 与 deploy.mjs 的 FILES 一致
const JUNCTIONS = ["src", "ui"];

/* 白名单文件名解析：显式锚定根目录边界后再进文件读取 */
function resolveWithin(root, name) {
  const target = path.resolve(root, name);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("路径越界: " + name);
  return target;
}

test("部署目录与源码一致（硬链接断链检测）", t => {
  if (!fs.existsSync(DEST)) return t.skip("dist-new 不存在（本机未打包过），跳过部署一致性检查");

  for (const f of FILES) {
    const src = resolveWithin(APP_ROOT, f);
    const dst = resolveWithin(DEST, f);
    const hasSrc = fs.existsSync(src);
    const hasDst = fs.existsSync(dst);
    if (!hasSrc && !hasDst) continue; // 机器差异文件（如 gpu-off.flag）两侧都无即一致
    assert.ok(hasSrc && hasDst,
      `${f}: 源(${hasSrc})与部署(${hasDst})存在性不一致 —— 跑 npm run deploy 修复`);
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dst);
    assert.equal(Buffer.compare(a, b), 0,
      `${f} 与部署目录内容不一致 —— 硬链接已断链（生产在跑旧代码），跑 npm run deploy 修复`);
  }

  for (const d of JUNCTIONS) {
    assert.ok(fs.existsSync(resolveWithin(DEST, d)),
      `部署目录缺少 ${d}/（应由打包产物提供）—— 需要重新 npm run dist`);
  }
});
