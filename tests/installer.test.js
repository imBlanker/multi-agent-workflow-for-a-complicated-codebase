import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { install, uninstall, update } from "../src/installer.js";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "maw-inst-"));
const claudeDir = path.join(tmpHome, ".claude");
fs.mkdirSync(path.join(claudeDir, "commands"), { recursive: true });

test.before(() => {
  process.env.HOME = tmpHome; // detectHost uses os.homedir(); but we pass claudeDir explicitly
});

test("install copies commands/agents/skills into the host and writes a manifest", () => {
  const r = install({ claudeDir });
  assert.equal(r.ok, true);
  assert.ok(r.copied.some((c) => c.includes("commands")));
  assert.ok(r.copied.some((c) => c.includes("agents")));
  assert.ok(r.copied.some((c) => c.includes("skills")));
  assert.ok(fs.existsSync(path.join(claudeDir, "commands", "maw-plan.md")));
  assert.ok(fs.existsSync(path.join(claudeDir, "agents", "orchestrator.md")));
  assert.ok(fs.existsSync(path.join(claudeDir, "skills", "maw-orchestration", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(tmpHome, ".maw", "installed.json")));
});

test("update overwrites templates but preserves user-added files", () => {
  const userFile = path.join(claudeDir, "commands", "user-kept.md");
  fs.writeFileSync(userFile, "keep me");
  const r = update({ claudeDir });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(userFile), "user file must survive update");
  assert.ok(fs.existsSync(path.join(claudeDir, "commands", "maw-plan.md")));
});

test("uninstall removes maw-* files only and the manifest", () => {
  // add a non-maw file to ensure we don't nuke it
  const other = path.join(claudeDir, "commands", "other-tool.md");
  fs.writeFileSync(other, "not mine");
  const r = uninstall();
  assert.equal(r.ok, true);
  assert.ok(!fs.existsSync(path.join(claudeDir, "commands", "maw-plan.md")), "maw command removed");
  assert.ok(fs.existsSync(other), "non-maw file preserved");
});

test.after(() => {
  process.env.HOME = os.homedir();
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});
