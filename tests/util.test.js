import { test } from "node:test";
import assert from "node:assert/strict";
import { toYaml, slug, round, yamlQuote } from "../src/util.js";

test("round handles float epsilon", () => {
  assert.equal(round(0.1 + 0.2, 2), 0.3);
  assert.equal(round(1.005, 2), 1.01);
});

test("slug lowercases and dashes", () => {
  assert.equal(slug("Multi Agent Workflow!"), "multi-agent-workflow");
  assert.equal(slug("a.b.c"), "a-b-c");
});

test("yamlQuote quotes special values", () => {
  assert.equal(yamlQuote("true"), '"true"');
  assert.equal(yamlQuote("12.5"), '"12.5"');
  assert.equal(yamlQuote("plain"), "plain");
  assert.equal(yamlQuote("a:b"), '"a:b"');
});

test("toYaml produces valid-looking nested yaml", () => {
  const y = toYaml({ a: 1, b: { c: 2 }, d: ["x", "y"] });
  assert.match(y, /a: 1/);
  assert.match(y, /b:/);
  assert.match(y, /- x/);
  assert.match(y, /- y/);
});
