import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { makeFixtureDb } from "./fixtures/make-db.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maw-cli-"));
const project = path.join(tmp, "proj");
fs.mkdirSync(project, { recursive: true });
// seed a few code files so probe has something
fs.writeFileSync(path.join(project, "a.js"), "console.log(1)\n");
fs.writeFileSync(path.join(project, "b.js"), "console.log(2)\n");
fs.writeFileSync(path.join(project, "c.py"), "print(1)\n");
const dbPath = path.join(tmp, "cc-switch.db");
makeFixtureDb(dbPath, { withLogs: true });

const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "bin", "maw.js");

/** @param {string[]} args @param {object} [opts] */
function run(args, opts = {}) {
  return execFileSync("node", [BIN, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, CC_SWITCH_DB: dbPath, HOME: os.homedir() },
    maxBuffer: 8 * 1024 * 1024,
    ...opts,
  });
}

test("maw version", () => {
  const out = run(["version"]);
  assert.match(out, /^maw /);
});

test("maw doctor runs and reports checks", () => {
  const out = run(["doctor"]);
  assert.match(out, /maw doctor/);
  assert.match(out, /cc-switch database/);
});

test("maw plan probes the project and writes .maw/", () => {
  const out = run(["plan", "--project", project, "--risk", "high", "--parallel", "4"]);
  assert.match(out, /plan:/);
  assert.match(out, /agents:/);
  assert.ok(fs.existsSync(path.join(project, ".maw", "workflow.json")));
  assert.ok(fs.existsSync(path.join(project, ".maw", "config.yaml")));
  assert.ok(fs.existsSync(path.join(project, ".maw", "plan.md")));
  assert.ok(fs.existsSync(path.join(project, ".maw", "agents", "reviewer.json")));
});

test("maw cost reports real rate from fixture logs", () => {
  const out = run(["cost", "--window", "120"]);
  assert.match(out, /Cost rate/);
  assert.match(out, /USD\/min/);
});

test("maw guard allows then denies at the per-agent limit", () => {
  const allow = run(["guard", "--project", project, "--per-agent", "0.5", "--window", "120"]);
  // fixture sess-A at ~$0.75/min over 120s => over $0.5/min per-agent => DENY
  assert.match(allow, /DENY/);
  const big = run(["guard", "--project", project, "--per-agent", "100", "--total", "100", "--concurrency", "4", "--window", "120"]);
  assert.match(big, /ALLOW/);
});

test("maw add-agent / remove-agent mutate the plan", () => {
  run(["add-agent", "--project", project, "--role", "static-analyzer", "--model", "claude-sonnet-5", "--app", "claude", "--task", "Static analysis pass."]);
  assert.ok(fs.existsSync(path.join(project, ".maw", "agents", "static-analyzer.json")));
  run(["remove-agent", "--project", project, "--role", "static-analyzer"]);
  assert.ok(!fs.existsSync(path.join(project, ".maw", "agents", "static-analyzer.json")));
});

test("maw run emits batched execution guidance", () => {
  const out = run(["run", "--project", project]);
  assert.match(out, /Batch 1/);
  assert.match(out, /maw guard/);
});

test("maw graph reports nodes/edges and batches", () => {
  const out = run(["graph", "--project", project]);
  const j = JSON.parse(out);
  assert.ok(j.nodes > 0);
  assert.ok(j.batches > 0);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
