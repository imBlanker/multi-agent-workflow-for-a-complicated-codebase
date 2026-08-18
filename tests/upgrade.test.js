// @ts-check
// Tests for `mawf upgrade` (self-upgrade: checkout ff-pull / npm / squat detection).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { upgrade, detectInstallMode } from "../src/upgrade.js";

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
}

/** Build a bare remote + a clean clone containing a minimal maw-like package. */
function mkCheckout(version = "0.1.0") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maw-upg-"));
  const remote = path.join(dir, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { encoding: "utf8" });
  const seed = path.join(dir, "seed");
  fs.mkdirSync(path.join(seed, "bin"), { recursive: true });
  fs.writeFileSync(path.join(seed, "package.json"), JSON.stringify({ name: "multi-agents-workflow", version, bin: { mawf: "bin/mawf.js" } }, null, 2));
  fs.writeFileSync(path.join(seed, "bin", "mawf.js"), "#!/usr/bin/env node\n");
  git(["init", "-b", "main"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-m", "init"], seed);
  git(["remote", "add", "origin", remote], seed);
  git(["push", "-u", "origin", "main"], seed);
  const clone = path.join(dir, "clone");
  execFileSync("git", ["clone", remote, clone], { encoding: "utf8" });
  return { dir, remote, clone };
}

/** Push one commit bumping the version on the bare remote. */
function pushVersion(remote, version) {
  const w = path.join(path.dirname(remote), "w-" + version);
  execFileSync("git", ["clone", remote, w], { encoding: "utf8" });
  const pkg = JSON.parse(fs.readFileSync(path.join(w, "package.json"), "utf8"));
  pkg.version = version;
  fs.writeFileSync(path.join(w, "package.json"), JSON.stringify(pkg, null, 2));
  git(["add", "-A"], w);
  git(["commit", "-m", "v" + version], w);
  git(["push", "origin", "main"], w);
}

test("checkout mode: --dry-run prints the exact steps and changes nothing", () => {
  const { clone } = mkCheckout();
  const before = git(["rev-parse", "HEAD"], clone);
  const r = upgrade({ pkgRoot: clone, dryRun: true });
  assert.equal(r.ok, true);
  assert.match(r.output.join("\n"), /dry-run: git .* fetch origin/);
  assert.match(r.output.join("\n"), /dry-run: git .* merge --ff-only origin\/main/);
  assert.equal(git(["rev-parse", "HEAD"], clone), before, "dry-run must not move HEAD");
});

test("checkout mode: clean ff-pull advances HEAD and reports old→new version", () => {
  const { clone, remote } = mkCheckout("0.1.0");
  pushVersion(remote, "0.2.0");
  const r = upgrade({ pkgRoot: clone });
  assert.equal(r.ok, true, r.error || "");
  assert.equal(r.from, "0.1.0");
  assert.equal(r.to, "0.2.0");
  assert.match(r.output.join("\n"), /npx \. update/);
  const pkg = JSON.parse(fs.readFileSync(path.join(clone, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.2.0");
});

test("checkout mode: dirty tree aborts before any fetch, with manual guidance", () => {
  const { clone } = mkCheckout();
  fs.writeFileSync(path.join(clone, "dirty.txt"), "local edit");
  const before = git(["rev-parse", "HEAD"], clone);
  const r = upgrade({ pkgRoot: clone });
  assert.equal(r.ok, false);
  assert.match(r.error, /dirty/);
  assert.match(r.error, /never stashes/);
  assert.equal(git(["rev-parse", "HEAD"], clone), before, "HEAD must not move on abort");
});

test("checkout mode: diverged branch aborts with ff-only guidance (no history rewrite)", () => {
  const { clone, remote } = mkCheckout("0.1.0");
  pushVersion(remote, "0.2.0");
  fs.writeFileSync(path.join(clone, "local.txt"), "local divergence");
  git(["add", "-A"], clone);
  git(["commit", "-m", "local"], clone);
  const r = upgrade({ pkgRoot: clone });
  assert.equal(r.ok, false);
  assert.match(r.error, /ff-only/);
});

test("checkout mode: --tag is rejected with a clear message", () => {
  const { clone } = mkCheckout();
  const r = upgrade({ pkgRoot: clone, tag: "beta" });
  assert.equal(r.ok, false);
  assert.match(r.error, /reserved for npm-mode/);
});

test("npm mode: squatted legacy name is reported, never installed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maw-upg-npm-"));
  const pkgRoot = path.join(dir, "lib", "node_modules", "multi-agent-workflow");
  fs.mkdirSync(pkgRoot, { recursive: true });
  fs.writeFileSync(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "multi-agent-workflow", version: "0.1.0" }));
  const det = detectInstallMode(pkgRoot, { npmPrefix: path.join(dir, "lib") });
  assert.equal(det.mode, "npm");
  assert.equal(det.squatted, true);
  const r = upgrade({ pkgRoot, npmPrefix: path.join(dir, "lib") });
  assert.equal(r.ok, true);
  assert.match(r.output.join("\n"), /unrelated third-party package/);
  assert.match(r.output.join("\n"), /refusing to run npm i -g/);
});

test("npm mode: dry-run prints the install command without running it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maw-upg-npm2-"));
  const pkgRoot = path.join(dir, "lib", "node_modules", "@scope", "maw");
  fs.mkdirSync(pkgRoot, { recursive: true });
  fs.writeFileSync(path.join(pkgRoot, "package.json"), JSON.stringify({ name: "@scope/maw", version: "0.1.0" }));
  const r = upgrade({ pkgRoot, npmPrefix: path.join(dir, "lib"), dryRun: true, tag: "beta" });
  assert.equal(r.ok, true);
  assert.match(r.output.join("\n"), /dry-run: would run `npm i -g @scope\/maw@beta`/);
});
