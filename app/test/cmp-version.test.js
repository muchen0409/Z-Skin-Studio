/* cmpVersion 单测：v2.0.0 修复的"检查更新 100% 崩溃"函数的契约固化 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("./helpers/electron-mock");
install();
const { cmpVersion } = require("../src/zcode");

test("相等与 v 前缀剥离", () => {
  assert.equal(cmpVersion("1.2.3", "1.2.3"), 0);
  assert.equal(cmpVersion("v1.2.3", "1.2.3"), 0);
  assert.equal(cmpVersion("V3.14.3", "3.14.3"), 0);
  assert.equal(cmpVersion("3.14.3", "v3.14.3"), 0);
});

test("逐段数值比较（不是字典序）", () => {
  assert.equal(cmpVersion("1.10.0", "1.9.9"), 1);
  assert.equal(cmpVersion("1.9.9", "1.10.0"), -1);
  assert.equal(cmpVersion("3.14.3", "3.14.13"), -1);
  assert.equal(cmpVersion("2.0.0", "1.9.9"), 1);
});

test("预发布段：数字段 > 非数字段（semver 语义）", () => {
  assert.equal(cmpVersion("1.2.3-beta", "1.2.3"), -1);
  assert.equal(cmpVersion("1.2.3", "1.2.3-beta"), 1);
  assert.equal(cmpVersion("1.2.3-beta", "1.2.3-alpha"), 1);
});

test("段数不齐：缺失段视为更旧", () => {
  assert.equal(cmpVersion("1.2", "1.2.0"), -1);
  assert.equal(cmpVersion("1.2.0", "1.2"), 1);
});

test("异常输入不抛异常，返回数值", () => {
  assert.equal(cmpVersion(null, ""), 0);
  assert.equal(cmpVersion("", "1"), -1);
  assert.equal(cmpVersion("abc", "abd"), -1);
  assert.equal(cmpVersion(1, 1), 0);
  assert.equal(typeof cmpVersion(undefined, "x"), "number");
});
