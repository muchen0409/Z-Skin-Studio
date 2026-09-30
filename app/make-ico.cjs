/* 一次性工具：把仓库根的 Zcode+.png 转成多尺寸 icon.ico（打包与窗口图标用）。
   用法：npx electron make-ico.cjs —— 需要 nativeImage，故借 electron 运行。
   ICO 容器为 ICONDIR + ICONDIRENTRY×N + 各尺寸 PNG 负载（Vista+ 支持 PNG 条目）。 */
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(() => {
  const src = path.join(__dirname, "..", "Zcode+.png");
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) { console.error("源图读取失败: " + src); app.exit(1); return; }
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = sizes.map(s => img.resize({ width: s, height: s }).toPNG());
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map((png, i) => {
    const s = sizes[i];
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);            // 0 表示 256
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4);                         // 类型：图标
    e.writeUInt16LE(32, 6);                        // 位深（仅元数据）
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  const ico = Buffer.concat([header, ...entries, ...pngs]);
  fs.writeFileSync(path.join(__dirname, "icon.ico"), ico);
  console.log("icon.ico 已生成:", ico.length, "字节");
  app.quit();
});
