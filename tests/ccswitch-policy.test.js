import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readProfiles, createProjectProfile, readRouting, routingPolicy, applyRouting, projectSyncEnabled } from "../src/ccswitch.js";
import { makeFixtureDb } from "./fixtures/make-db.mjs";

// cc-switch "project" functionality is DECOUPLED by default (2026-08-12):
// profiles are read/written only when MAW_CC_PROJECT_SYNC=1 is set. The
// legacy profile tests below run with the env on; dedicated tests assert the
// disabled-by-default behavior.
const OLD_ENV = process.env.MAW_CC_PROJECT_SYNC;
process.env.MAW_CC_PROJECT_SYNC = "1";
test.after(() => {
  if (OLD_ENV === undefined) delete process.env.MAW_CC_PROJECT_SYNC;
  else process.env.MAW_CC_PROJECT_SYNC = OLD_ENV;
});

// non-OAuth fixture: claude routing OFF + failover OFF (violation), codex OFF (violation, should be ON)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maw-pol-"));
const dbPath = path.join(tmp, "cc-switch.db");
makeFixtureDb(dbPath, { withLogs: true });

test("readProfiles lists the protected 默认 profiles with isDefault=true", () => {
  const { profiles } = readProfiles({ dbPath });
  const defaults = profiles.filter((p) => p.isDefault);
  assert.deepEqual(defaults.map((p) => p.name).sort(), ["Claude Code 默认", "Codex 默认"]);
  for (const p of profiles) assert.ok(p.payload && typeof p.payload === "object");
});

test("createProjectProfile creates a NEW project profile and never touches 默认", () => {
  const before = readProfiles({ dbPath }).profiles.map((p) => p.name);
  const r = createProjectProfile({ name: "MAW: myproj (alice)", user: "alice", dbPath });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.ok(r.id);
  const after = readProfiles({ dbPath });
  // 默认 profiles still present and unchanged
  assert.ok(after.profiles.some((p) => p.name === "Claude Code 默认"));
  assert.ok(after.profiles.some((p) => p.name === "Codex 默认"));
  // new profile added
  assert.ok(after.profiles.some((p) => p.name === "MAW: myproj (alice)"));
  // protected defaults surfaced
  assert.deepEqual(r.protectedDefaults.sort(), ["Claude Code 默认", "Codex 默认"]);
  // no 默认 profile was modified (count unchanged)
  assert.equal(after.profiles.filter((p) => p.isDefault).length, before.filter((n) => n.includes("默认")).length);
});

test("createProjectProfile is idempotent (reuses without modification)", () => {
  const r1 = createProjectProfile({ name: "MAW: reuse-me", user: "alice", dbPath });
  assert.equal(r1.created, true);
  const r2 = createProjectProfile({ name: "MAW: reuse-me", user: "alice", dbPath });
  assert.equal(r2.reused, true);
  assert.equal(r1.id, r2.id);
  const { profiles } = readProfiles({ dbPath });
  assert.equal(profiles.filter((p) => p.name === "MAW: reuse-me").length, 1);
});

test("createProjectProfile REFUSES a name containing 默认", () => {
  const r = createProjectProfile({ name: "Claude Code 默认", user: "x", dbPath });
  assert.equal(r.ok, false);
  assert.match(r.error, /默认/);
});

test("projectSyncEnabled() defaults to FALSE (decoupled) and honors MAW_CC_PROJECT_SYNC", () => {
  const old = process.env.MAW_CC_PROJECT_SYNC;
  try {
    delete process.env.MAW_CC_PROJECT_SYNC;
    assert.equal(projectSyncEnabled(), false);
    for (const v of ["1", "true", "yes", "TRUE", "Yes"]) {
      process.env.MAW_CC_PROJECT_SYNC = v;
      assert.equal(projectSyncEnabled(), true, v);
    }
    process.env.MAW_CC_PROJECT_SYNC = "0";
    assert.equal(projectSyncEnabled(), false);
  } finally {
    if (old === undefined) delete process.env.MAW_CC_PROJECT_SYNC;
    else process.env.MAW_CC_PROJECT_SYNC = old;
  }
});

test("createProjectProfile is DISABLED by default (decoupled): refuses, writes nothing", () => {
  const old = process.env.MAW_CC_PROJECT_SYNC;
  try {
    delete process.env.MAW_CC_PROJECT_SYNC;
    const before = readProfiles({ dbPath }).profiles.map((p) => p.name);
    const r = createProjectProfile({ name: "MAW: decoupled-proj", user: "alice", dbPath });
    assert.equal(r.ok, false);
    assert.equal(r.disabled, true);
    assert.match(r.error, /decoupled/i);
    const after = readProfiles({ dbPath }).profiles.map((p) => p.name);
    assert.deepEqual(after, before, "no profile row must be written while decoupled");
  } finally {
    if (old === undefined) delete process.env.MAW_CC_PROJECT_SYNC;
    else process.env.MAW_CC_PROJECT_SYNC = old;
  }
});

test("routingPolicy flags claude off + codex off as violations (no OAuth)", () => {
  const routing = readRouting({ dbPath });
  assert.equal(routing.codexOAuthInUse, false);
  const pol = routingPolicy(routing);
  assert.equal(pol.compliant, false);
  // claude local routing + auto-failover must both be ON -> both violated
  assert.ok(pol.violations.some((v) => v.app === "claude" && v.field === "local_routing" && v.expected === "on"));
  assert.ok(pol.violations.some((v) => v.app === "claude" && v.field === "auto_failover" && v.expected === "on"));
  // codex must be ON (no OAuth) but is OFF -> violated
  assert.ok(pol.violations.some((v) => v.app === "codex" && v.field === "local_routing" && v.expected === "on"));
});

test("createProjectProfile skips pi hosts (not cc-switch-managed) and writes nothing", () => {
  const r = createProjectProfile({ name: "MAW: pi-proj", user: "x", hostApp: "pi", dbPath });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /not cc-switch-managed/);
  const { profiles } = readProfiles({ dbPath });
  assert.ok(!profiles.some((p) => p.name === "MAW: pi-proj"), "no profile row must be written for pi");
});

test("routingPolicy reports pi as N/A (not cc-switch-managed)", () => {
  const pol = routingPolicy(readRouting({ dbPath }));
  assert.match(String(pol.pi), /N\/A/);
});

test("applyRouting({fix:true}) writes ONLY proxy_config (claude on+failover; codex on) -> compliant", () => {
  const ar = applyRouting({ dbPath, fix: true });
  assert.equal(ar.ok, true);
  assert.ok(ar.applied.length >= 2);
  // re-read: now compliant
  const pol = routingPolicy(readRouting({ dbPath }));
  assert.equal(pol.compliant, true);
  // 默认 profiles still untouched
  const { profiles } = readProfiles({ dbPath });
  assert.ok(profiles.some((p) => p.name === "Claude Code 默认"));
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

// --- OAuth branch: when codex uses OpenAI OAuth login, codex routing must be OFF ---
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "maw-oauth-"));
const dbPath2 = path.join(tmp2, "cc-switch.db");
makeFixtureDb(dbPath2, { withLogs: true, codexOAuth: true });

test("codex OAuth login is detected (auth_mode chatgpt + codex_oauth_auth.json)", () => {
  const routing = readRouting({ dbPath: dbPath2 });
  assert.equal(routing.codexOAuthInUse, true);
});

test("with OAuth, routingPolicy expects codex OFF; applyRouting sets it OFF", () => {
  const pol = routingPolicy(readRouting({ dbPath: dbPath2 }));
  // codex is OFF in fixture + OAuth -> no codex violation; claude still violated
  assert.ok(!pol.violations.some((v) => v.app === "codex" && v.field === "local_routing" && v.expected === "on"));
  const ar = applyRouting({ dbPath: dbPath2, fix: true });
  assert.equal(ar.ok, true);
  assert.ok(ar.applied.some((a) => /codex.*OFF/i.test(a)));
  const after = readRouting({ dbPath: dbPath2 });
  assert.equal(after.codex.enabled, 0);
});

test.after(() => { try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch {} });
