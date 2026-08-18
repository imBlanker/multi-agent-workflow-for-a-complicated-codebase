// @ts-check
// `mawf upgrade` — self-upgrade (trellis-upgrade parity, fork-first aware).
//
// Two install modes, auto-detected from the package root the running `mawf`
// resolves to (same PKG_ROOT logic as installer.js):
//
// - checkout mode (default): the repo is a git checkout (fork-first). Upgrade
//   = `git fetch <remote>` + `git merge --ff-only <remote>/<branch>` on the
//   current branch. HARD RULES: never stash, never rebase, never force. A
//   dirty tree or a diverged branch aborts with the exact manual commands.
//   Success reports old→new version and prints the follow-up
//   `npx . update` (refresh host templates; keeps user edits) — run it
//   automatically only with --apply-templates (spawning bin/mawf.js so the
//   POST-merge code runs, not this already-loaded process).
//
// - npm mode: the package root sits under the global npm prefix with no .git
//   → `npm i -g <name>@latest`. CAVEAT (verified 2026-08-18): the unscoped
//   name `multi-agent-workflow` on npm is an unrelated third-party package
//   (squatted), so legacy installs under that name are REPORTED, not
//   upgraded. Publishes must use a different (scoped or new) name.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { readJson, exists } from "./util.js";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** @returns {string} */
function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 60000, ...opts }).trim();
}

/** @param {string} cmd @param {string[]} args @param {object} [opts] */
function trySh(cmd, args, opts = {}) {
  try { return { ok: true, out: sh(cmd, args, opts) }; }
  catch (e) { return { ok: false, out: "", err: String(e?.message || e) }; }
}

/**
 * Detect how this `mawf` was installed.
 * @param {string} pkgRoot
 * @param {{ npmPrefix?: string }} [opts]
 * @returns {{ mode: "checkout"|"npm", pkgRoot: string, pkgName: string, version: string, gitRoot?: string, npmPrefix?: string, squatted?: boolean }}
 */
export function detectInstallMode(pkgRoot = PKG_ROOT, opts = {}) {
  const pkg = readJson(path.join(pkgRoot, "package.json"), { name: "?", version: "?" });
  const gitRoot = gitRootOf(pkgRoot);
  if (gitRoot) return { mode: "checkout", pkgRoot, pkgName: pkg.name, version: pkg.version, gitRoot };
  const npmPrefix = opts.npmPrefix ?? npmGlobalPrefix();
  const underNpm = !!npmPrefix && path.resolve(pkgRoot).startsWith(path.resolve(npmPrefix) + path.sep);
  return {
    mode: underNpm ? "npm" : "checkout", // unknown layouts degrade to checkout guidance
    pkgRoot, pkgName: pkg.name, version: pkg.version,
    npmPrefix, squatted: pkg.name === "multi-agent-workflow",
  };
}

/** @param {string} dir @returns {string|undefined} */
function gitRootOf(dir) {
  let cur = path.resolve(dir);
  while (true) {
    if (exists(path.join(cur, ".git"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

/** @returns {string} */
function npmGlobalPrefix() {
  const r = trySh("npm", ["prefix", "-g"]);
  return r.ok ? r.out : "";
}

/**
 * Self-upgrade.
 * @param {{ dryRun?: boolean, remote?: string, applyTemplates?: boolean, tag?: string, pkgRoot?: string, npmPrefix?: string }} [opts]
 * @returns {{ ok: boolean, mode: string, from?: string, to?: string, followUp?: string, output: string[], error?: string }}
 */
export function upgrade(opts = {}) {
  /** @type {string[]} */
  const output = [];
  const det = detectInstallMode(opts.pkgRoot || PKG_ROOT, { npmPrefix: opts.npmPrefix });
  const dry = !!opts.dryRun;

  if (opts.tag && det.mode === "checkout") {
    return { ok: false, mode: det.mode, output: [], error: "--tag is reserved for npm-mode installs; this is a git checkout — pull a branch/tag with git instead" };
  }

  if (det.mode === "npm") {
    if (det.squatted) {
      // The unscoped name on npm is NOT this project. Report; never install it.
      return {
        ok: true, mode: "npm", output: [
          `this install resolves to package name "${det.pkgName}", which on npm is an unrelated third-party package (name squatted)`,
          `refusing to run npm i -g; upgrade from your git checkout instead (clone the repo, \`npx . install\`)`,
        ],
      };
    }
    const installCmd = `npm i -g ${det.pkgName}@${opts.tag || "latest"}`;
    if (dry) return { ok: true, mode: "npm", from: det.version, output: [`dry-run: would run \`${installCmd}\``] };
    try {
      const out = sh("npm", ["i", "-g", `${det.pkgName}@${opts.tag || "latest"}`], { timeout: 300000 });
      return { ok: true, mode: "npm", from: det.version, output: [installCmd, ...(out || "").split("\n").filter(Boolean).slice(-5)] };
    } catch (e) {
      return { ok: false, mode: "npm", from: det.version, output: [installCmd], error: String(e?.message || e) };
    }
  }

  // ---- checkout mode ----
  const gitRoot = det.gitRoot || det.pkgRoot;
  const remote = opts.remote || "origin";
  const branch = trySh("git", ["-C", gitRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok || branch.out === "HEAD") {
    return { ok: false, mode: "checkout", output: [], error: `cannot resolve the current branch in ${gitRoot} (detached HEAD?) — upgrade manually with git` };
  }

  const dirty = trySh("git", ["-C", gitRoot, "status", "--porcelain"]);
  if (dirty.ok && dirty.out) {
    return {
      ok: false, mode: "checkout", output: [],
      error: `working tree is dirty in ${gitRoot} — commit or stash first; mawf upgrade never stashes/rebases/forces. Manual: git -C ${gitRoot} status`,
    };
  }

  const remotes = trySh("git", ["-C", gitRoot, "remote"]);
  if (!remotes.ok || !remotes.out.split(/\s+/).includes(remote)) {
    return {
      ok: false, mode: "checkout", output: [],
      error: `git remote "${remote}" not found (have: ${remotes.out || "none"}). Fork users: pass --remote <name>, or add upstream: git -C ${gitRoot} remote add upstream https://github.com/imBlanker/multi-agents-workflow.git`,
    };
  }

  const target = `${remote}/${branch.out}`;
  if (dry) {
    return {
      ok: true, mode: "checkout", from: det.version, output: [
        `dry-run: git -C ${gitRoot} fetch ${remote}`,
        `dry-run: git -C ${gitRoot} merge --ff-only ${target} (branch ${branch.out})`,
        `dry-run: follow-up ${opts.applyTemplates ? "would run" : "hint"}: npx . update${opts.applyTemplates ? "" : " (--apply-templates to chain automatically)"}`,
      ],
    };
  }

  const fetch = trySh("git", ["-C", gitRoot, "fetch", remote], { timeout: 120000 });
  if (!fetch.ok) return { ok: false, mode: "checkout", output: [], error: `git fetch ${remote} failed: ${fetch.err}` };

  const merge = trySh("git", ["-C", gitRoot, "merge", "--ff-only", target], { timeout: 120000 });
  if (!merge.ok) {
    return {
      ok: false, mode: "checkout", output: [],
      error: `ff-only merge to ${target} failed (diverged from remote?) — resolve manually; mawf upgrade never rewrites history. Manual: git -C ${gitRoot} merge --ff-only ${target}   # or git pull --rebase ${remote} ${branch.out}`,
    };
  }

  const newPkg = readJson(path.join(gitRoot, "package.json"), { version: det.version });
  const followUp = "npx . update";
  output.push(`pulled ${target}: ${det.version} -> ${newPkg.version}`);
  if (opts.applyTemplates) {
    const r = spawnSync(process.execPath, [path.join(gitRoot, "bin", "mawf.js"), "update"], {
      cwd: gitRoot, encoding: "utf8", timeout: 300000,
    });
    const tail = String(r.stdout || "").trim().split("\n").filter(Boolean).slice(-3);
    output.push("templates refreshed (post-merge code):", ...tail);
  } else {
    output.push(`follow-up: run \`${followUp}\` to refresh installed host templates (--apply-templates chains it automatically)`);
  }
  return { ok: true, mode: "checkout", from: det.version, to: newPkg.version, followUp, output };
}
