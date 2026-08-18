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

test("install on a pi host copies skills+prompts into the pi home and records piDir", () => {
  const piHome = path.join(tmpHome, ".pi", "agent");
  fs.mkdirSync(piHome, { recursive: true });
  process.env.MAW_HOST = "pi";
  try {
    const r = install({ claudeDir, piDir: piHome });
    assert.equal(r.ok, true);
    assert.ok(r.copied.some((c) => c.includes("pi skills")), `pi skills missing from: ${r.copied.join(" | ")}`);
    assert.ok(r.copied.some((c) => c.includes("pi prompts")), `pi prompts missing`);
    assert.ok(fs.existsSync(path.join(piHome, "skills", "maw-orchestration", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(piHome, "prompts", "maw-plan.md")));
    const m = JSON.parse(fs.readFileSync(path.join(tmpHome, ".maw", "installed.json"), "utf8"));
    assert.equal(m.dirs.piDir, piHome);
  } finally { delete process.env.MAW_HOST; }
});

test("install on a dsh host copies skills into $DSH_HOME/skills and records dshDir; uninstall removes only maw-*", () => {
  const dshHome = path.join(tmpHome, ".dsh");
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(path.join(dshHome, "settings.yaml"), "llm-pi-ai:\n  providers: {}\n");
  process.env.MAW_HOST = "dsh";
  try {
    const r = install({ claudeDir, dshHome });
    assert.equal(r.ok, true);
    assert.ok(r.copied.some((c) => c.includes("dsh skills")), `dsh skills missing from: ${r.copied.join(" | ")}`);
    // no prompts surface for dsh
    assert.ok(!r.copied.some((c) => c.includes("dsh prompts")), "dsh has no prompts surface");
    assert.ok(fs.existsSync(path.join(dshHome, "skills", "maw-orchestration", "SKILL.md")));
    const m = JSON.parse(fs.readFileSync(path.join(tmpHome, ".maw", "installed.json"), "utf8"));
    assert.equal(m.dirs.dshDir, dshHome);
    // a non-maw dsh skill must survive uninstall
    fs.mkdirSync(path.join(dshHome, "skills", "user-skill"), { recursive: true });
    fs.writeFileSync(path.join(dshHome, "skills", "user-skill", "SKILL.md"), "# keep\n");
    const u = uninstall();
    assert.equal(u.ok, true);
    assert.ok(!fs.existsSync(path.join(dshHome, "skills", "maw-orchestration")), "maw skill removed");
    assert.ok(fs.existsSync(path.join(dshHome, "skills", "user-skill", "SKILL.md")), "non-maw dsh skill preserved");
  } finally { delete process.env.MAW_HOST; }
});

test("manifest v2 records every written file; uninstall removes ALL (incl. non-prefixed agents/hooks) and prunes empty dirs", () => {
  const r = install({ claudeDir });
  assert.equal(r.ok, true);
  // non-maw-prefixed plugin files ARE copied…
  assert.ok(fs.existsSync(path.join(claudeDir, "agents", "orchestrator.md")));
  assert.ok(fs.existsSync(path.join(claudeDir, "hooks", "hooks.json")));
  // …and ARE recorded in the v2 manifest
  const m = JSON.parse(fs.readFileSync(path.join(tmpHome, ".maw", "installed.json"), "utf8"));
  assert.ok(Array.isArray(m.files) && m.files.length >= 15, `manifest.files must record every write, got ${m.files?.length}`);
  assert.ok(m.files.some((f) => f.endsWith(path.join("agents", "orchestrator.md"))));
  assert.ok(m.files.some((f) => f.endsWith(path.join("hooks", "hooks.json"))));
  // a user file in the same tree must survive
  fs.writeFileSync(path.join(claudeDir, "agents", "user-own.md"), "mine");
  const u = uninstall({ project: tmpHome });
  assert.equal(u.ok, true);
  assert.ok(!fs.existsSync(path.join(claudeDir, "agents", "orchestrator.md")), "non-prefixed agent file must be removed");
  assert.ok(!fs.existsSync(path.join(claudeDir, "hooks", "hooks.json")), "hooks.json must be removed");
  assert.ok(fs.existsSync(path.join(claudeDir, "agents", "user-own.md")), "user file preserved");
  assert.ok(!fs.existsSync(path.join(claudeDir, "hooks")), "empty hooks dir pruned");
  assert.ok(!fs.existsSync(path.join(tmpHome, ".maw", "installed.json")), "manifest removed");
});

test("legacy manifest (dirs only) still uninstalls via the prefix fallback", () => {
  install({ claudeDir });
  const mp = path.join(tmpHome, ".maw", "installed.json");
  const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  delete m.files; // pre-v2 shape
  fs.writeFileSync(mp, JSON.stringify(m));
  fs.writeFileSync(path.join(claudeDir, "commands", "user-own.md"), "mine");
  const u = uninstall({ project: tmpHome });
  assert.equal(u.ok, true);
  assert.ok(!fs.existsSync(path.join(claudeDir, "commands", "maw-plan.md")), "maw-* removed by fallback");
  assert.ok(fs.existsSync(path.join(claudeDir, "commands", "user-own.md")), "user file preserved by fallback");
});

test("uninstall keeps configs by default; --purge-config removes .maw and .pi/agents/maw-* (never trellis-*)", () => {
  const proj = path.join(tmpHome, "proj-x");
  fs.mkdirSync(path.join(proj, ".maw", "agents"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".maw", "workflow.json"), "{}");
  fs.mkdirSync(path.join(proj, ".pi", "agents"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".pi", "agents", "maw-worker.md"), "#");
  fs.writeFileSync(path.join(proj, ".pi", "agents", "trellis-implement.md"), "#");
  install({ claudeDir });
  const keep = uninstall({ project: proj });
  assert.ok(fs.existsSync(path.join(proj, ".maw", "workflow.json")), "default keeps configs");
  assert.ok(keep.kept.some((p) => p === path.join(proj, ".maw")));
  const purge = uninstall({ project: proj, purgeConfig: true });
  assert.ok(!fs.existsSync(path.join(proj, ".maw")), ".maw purged");
  assert.ok(!fs.existsSync(path.join(proj, ".pi", "agents", "maw-worker.md")), "maw-* pi agent purged");
  assert.ok(fs.existsSync(path.join(proj, ".pi", "agents", "trellis-implement.md")), "trellis-* pi agent preserved");
  assert.ok(purge.purged.some((p) => p === path.join(proj, ".maw")));
});

test("uninstall removes maw-* leftovers from an OLDER install even when the current manifest does not list them", () => {
  install({ claudeDir });
  // simulate an update() that dropped a skill: stale maw-* file on disk,
  // absent from the freshly written manifest
  fs.mkdirSync(path.join(claudeDir, "skills", "maw-retired-skill"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "skills", "maw-retired-skill", "SKILL.md"), "# old\n");
  const mp = path.join(tmpHome, ".maw", "installed.json");
  const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  assert.ok(!m.files.some((f) => f.includes("maw-retired-skill")), "fixture premise: not in manifest");
  const u = uninstall({ project: tmpHome });
  assert.ok(!fs.existsSync(path.join(claudeDir, "skills", "maw-retired-skill")), "stale maw-* leftover must be removed by the prefix safety net");
});

test.after(() => {
  process.env.HOME = os.homedir();
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
});
