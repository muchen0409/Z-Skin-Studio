/* 从 CHANGELOG.md 抽取指定版本的说明小节，供 Release 工作流生成 notes。
   用法：node extract-notes.cjs 2.5.0  （stdout 输出 markdown；找不到小节时回退一行标题） */
const fs = require("node:fs");
const path = require("node:path");

const version = String(process.argv[2] || "").trim();
if (!version) { console.error("用法: node extract-notes.cjs <version>"); process.exit(1); }

const md = fs.readFileSync(path.join(__dirname, "CHANGELOG.md"), "utf8");
const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hm = md.match(new RegExp(`^## ${esc}\\b[^\\n]*$`, "m"));

if (!hm) {
  process.stdout.write(`Zcode+ v${version}\n\n（CHANGELOG 中未找到该版本小节，请查看提交记录。）\n`);
} else {
  const from = hm.index + hm[0].length + 1; // 越过小节标题行
  const rest = md.slice(from);
  const nm = rest.match(/^## /m);           // 下一个小节头为止
  const body = nm ? rest.slice(0, nm.index) : rest;
  process.stdout.write(body.trim() + "\n");
}
