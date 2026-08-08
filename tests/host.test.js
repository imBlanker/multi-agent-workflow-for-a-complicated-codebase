// @ts-check
// Tests for host detection (Claude Code / Codex / Pi Agent) and capability flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectHost, hostCapabilities } from "../src/host.js";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maw-host-"));
}
function mk(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

test("detectHost: pi home -> app=pi with pi capabilities and dirs", () => {
  const home = tmpHome();
  const piDir = mk(path.join(home, ".pi", "agent"));
  const projectDir = mk(path.join(home, "project"));
  const h = detectHost({
    piDir,
    projectDir,
    claudeDir: path.join(home, ".claude"),
    codexDir: path.join(home, ".codex"),
  });
  assert.equal(h.app, "pi");
  assert.equal(h.homeDir, piDir);
  assert.equal(h.hasSubagents, true);
  assert.equal(h.hasMultiAgent, true);
  assert.equal(h.hasDynamicWorkflow, true);
  assert.equal(h.hasGraphWorkflow, false);
  // global + project pi dirs both wired
  assert.ok(h.agentsDirs.some((d) => d === path.join(piDir, "agents")));
  assert.ok(h.agentsDirs.some((d) => d === path.join(projectDir, ".pi", "agents")));
  assert.ok(h.commandsDirs.some((d) => d === path.join(piDir, "prompts")));
  assert.ok(h.commandsDirs.some((d) => d === path.join(projectDir, ".pi", "prompts")));
  assert.ok(h.skillsDirs.some((d) => d === path.join(projectDir, ".agents", "skills")));
  assert.ok(h.extensionsDirs.some((d) => d === path.join(piDir, "extensions")));
  assert.ok(h.extensionsDirs.some((d) => d === path.join(projectDir, ".pi", "extensions")));
  assert.ok(h.detected.some((s) => s.includes("Pi Agent home")));
  const caps = hostCapabilities(h);
  assert.ok(caps.includes("subagents"));
  assert.ok(caps.includes("multi-agent"));
  assert.ok(caps.includes("dynamic-workflow"));
});

test("detectHost: MAW_HOST=pi forces pi even when ~/.claude also exists", () => {
  const home = tmpHome();
  mk(path.join(home, ".claude")); // claude also present
  const piDir = mk(path.join(home, ".pi", "agent"));
  const projectDir = mk(path.join(home, "project"));
  process.env.MAW_HOST = "pi";
  try {
    const h = detectHost({
      piDir,
      projectDir,
      claudeDir: path.join(home, ".claude"),
      codexDir: path.join(home, ".codex"),
    });
    assert.equal(h.app, "pi");
    assert.equal(h.homeDir, piDir);
  } finally {
    delete process.env.MAW_HOST;
  }
});

test("detectHost: both claude + pi, no override -> claude-code precedence, pi still detected", () => {
  const home = tmpHome();
  const claudeDir = mk(path.join(home, ".claude"));
  const piDir = mk(path.join(home, ".pi", "agent"));
  const projectDir = mk(path.join(home, "project"));
  const h = detectHost({ claudeDir, piDir, projectDir, codexDir: path.join(home, ".codex") });
  assert.equal(h.app, "claude-code");
  assert.equal(h.homeDir, claudeDir);
  assert.ok(h.detected.some((s) => s.includes("Pi Agent home")));
  // pi dirs still listed (union) even though claude wins app
  assert.ok(h.agentsDirs.some((d) => d === path.join(piDir, "agents")));
  assert.ok(h.extensionsDirs.some((d) => d === path.join(piDir, "extensions")));
});

test("detectHost: claude-only detection unchanged (regression)", () => {
  const home = tmpHome();
  const claudeDir = mk(path.join(home, ".claude"));
  const h = detectHost({
    claudeDir,
    piDir: path.join(home, ".pi", "agent"),
    codexDir: path.join(home, ".codex"),
    projectDir: home,
  });
  assert.equal(h.app, "claude-code");
  assert.equal(h.hasSubagents, true);
  assert.equal(h.hasMultiAgent, true);
  assert.equal(h.hasDynamicWorkflow, true);
  assert.equal(h.extensionsDirs.length, 0);
  assert.ok(!h.detected.some((s) => s.includes("Pi Agent")));
});

test("detectHost: nothing installed -> unknown", () => {
  const home = tmpHome();
  const h = detectHost({
    claudeDir: path.join(home, ".claude"),
    codexDir: path.join(home, ".codex"),
    piDir: path.join(home, ".pi", "agent"),
    projectDir: home,
  });
  assert.equal(h.app, "unknown");
  assert.equal(h.hasSubagents, false);
  assert.equal(h.extensionsDirs.length, 0);
});
