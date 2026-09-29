/* 社区主题：元数据归一化（v2.2.0 驼峰命名回归）、ID 解析、API 白名单 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("./helpers/electron-mock");
install();
const { normalizeMeta, parseCommunityRef, assertApiUri, installCommunityPack } = require("../src/community");

const SHA = "a".repeat(64);

/* 回归 2：线上 API 实际返回驼峰命名（v2.2.0 首发按帕斯卡推断导致真实导入失败），
   本 fixture 即驼峰形态的脱敏样本 */
const CAMEL_META = {
  id: "ver_deadbeefdeadbeef",
  name: "Aurora",
  authorDisplayName: "someone",
  packageBytes: 1024,
  packageSha256: SHA,
  applyCompatible: true,
  reviewedAt: "2026-09-28T00:00:00Z",
  license: "CC-BY-4.0",
  version: "1.0.0",
};

test("回归：驼峰命名的线上元数据可正常归一化", () => {
  const m = normalizeMeta(CAMEL_META);
  assert.equal(m.name, "Aurora");
  assert.equal(m.author, "someone");
  assert.equal(m.bytes, 1024);
  assert.equal(m.sha256, SHA);
  assert.equal(m.license, "CC-BY-4.0");
  assert.equal(m.version, "1.0.0");
});

test("帕斯卡命名（上游客户端内部归一化形状）同样接受", () => {
  const m = normalizeMeta({
    name: "P", authorDisplayName: "A",
    packageBytes: 10, packageSha256: SHA.toUpperCase(),
  });
  assert.equal(m.bytes, 10);
  assert.equal(m.sha256, SHA); // 大写 SHA 被规整为小写
});

test("缺完整性字段 / 超限 → 拒绝", () => {
  const bad = { name: "N", packageBytes: 10 }; // 无 SHA
  assert.throws(() => normalizeMeta(bad), /缺少必要的完整性字段/);
  assert.throws(() => normalizeMeta({ ...CAMEL_META, packageSha256: "zz" }), /缺少必要的完整性字段/);
  assert.throws(() => normalizeMeta({ ...CAMEL_META, packageBytes: 0 }), /缺少必要的完整性字段/);
  assert.throws(() => normalizeMeta({ ...CAMEL_META, packageBytes: 32 * 1024 * 1024 + 1 }), /缺少必要的完整性字段/);
  assert.throws(() => normalizeMeta({ ...CAMEL_META, name: "  " }), /缺少必要的完整性字段/);
});

test("上游前置检查：不兼容标记 / 未过审拒绝；字段缺失视为旧 schema 放行", () => {
  assert.throws(() => normalizeMeta({ ...CAMEL_META, applyCompatible: false }), /不兼容/);
  assert.throws(() => normalizeMeta({ ...CAMEL_META, reviewedAt: "" }), /未通过社区审核/);
  // 缺失不拒绝（旧 schema 兼容）
  const m = normalizeMeta({ name: "N", packageBytes: 1, packageSha256: SHA });
  assert.equal(m.name, "N");
});

test("截断保护：name/author 40 字、version 20 字、license 40 字", () => {
  const m = normalizeMeta({
    name: "x".repeat(100), authorDisplayName: "y".repeat(100),
    version: "9".repeat(30), license: "L".repeat(100),
    packageBytes: 1, packageSha256: SHA,
  });
  assert.equal(m.name.length, 40);
  assert.equal(m.author.length, 40);
  assert.equal(m.version.length, 20);
  assert.equal(m.license.length, 40);
});

test("parseCommunityRef：裸 ID / 主题页链接 / dreamskin:// 均可提取", () => {
  assert.equal(parseCommunityRef("ver_abcd1234"), "ver_abcd1234");
  assert.equal(parseCommunityRef("https://dreamskin.cc/theme/ver_abcd1234"), "ver_abcd1234");
  assert.equal(parseCommunityRef("dreamskin://apply?version=ver_abcd1234"), "ver_abcd1234");
  assert.equal(parseCommunityRef("ver_abcd1234 后面还有字"), "ver_abcd1234");
});

test("parseCommunityRef：非法输入返回 null", () => {
  assert.equal(parseCommunityRef(""), null);
  assert.equal(parseCommunityRef("ver_short"), null);          // 不足 8 位
  assert.equal(parseCommunityRef("ver_ABCD1234"), null);       // 大写不允许
  assert.equal(parseCommunityRef(null), null);
  assert.equal(parseCommunityRef("随便一段话"), null);
});

test("assertApiUri 白名单：仅 https + 固定 host + 精确路径", () => {
  const ok = assertApiUri("https://api.dreamskin.cc/v1/themes/ver_abcd1234");
  assert.ok(ok instanceof URL);
  assertApiUri("https://api.dreamskin.cc/v1/themes/ver_abcd1234/download");

  assert.throws(() => assertApiUri("http://api.dreamskin.cc/v1/themes/ver_abcd1234"), /白名单/);
  assert.throws(() => assertApiUri("https://api.evil.com/v1/themes/ver_abcd1234"), /白名单/);
  // host 前缀伪装与子域
  assert.throws(() => assertApiUri("https://api.dreamskin.cc.evil.com/v1/themes/ver_abcd1234"), /白名单/);
  // 凭据内嵌
  assert.throws(() => assertApiUri("https://u:p@api.dreamskin.cc/v1/themes/ver_abcd1234"), /白名单/);
  // IP 字面量
  assert.throws(() => assertApiUri("https://127.0.0.1/v1/themes/ver_abcd1234"), /白名单/);
  // 路径穿越（URL 构造器会归一化 ../，归一化后路径不再命中白名单）
  assert.throws(() => assertApiUri("https://api.dreamskin.cc/v1/themes/ver_abcd1234/../../evil"), /白名单/);
  // ID 不合法
  assert.throws(() => assertApiUri("https://api.dreamskin.cc/v1/themes/ver_BadID"), /白名单/);
  // 非 JSON 入口路径
  assert.throws(() => assertApiUri("https://api.dreamskin.cc/v1/other"), /白名单/);
});

test("installCommunityPack：无法识别 ID 时在联网前即失败", async () => {
  await assert.rejects(() => installCommunityPack("not-a-valid-ref"), /无法识别主题 ID/);
  await assert.rejects(() => installCommunityPack(""), /无法识别主题 ID/);
});
