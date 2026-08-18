// @ts-check
// Installer: copies the MAW plugin (commands/agents/hooks/skills) into the host
// agent software's directories, writes an install manifest, and runs an env
// check. Supports install / uninstall / update for Claude Code and (best-effort)
// Codex. Keeps everything reversible and non-destructive.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exists, isFile, ensureDir, writeJson, readJson, writeText } from "./util.js";
import { detectHost, hostCapabilities } from "./host.js";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/**
 * Copy a directory tree recursively.
 * @param {string} src
 * @param {string} dest
 * @returns {string[]} every file written (absolute paths)
 */
function copyTree(src, dest) {
  ensureDir(dest);
  /** @type {string[]} */
  const written = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) written.push(...copyTree(s, d));
    else { fs.copyFileSync(s, d); written.push(d); }
  }
  return written;
}

/**
 * @returns {string}
 */
function manifestDir() {
  return path.join(os.homedir(), ".maw");
}

/** @returns {{ version: string, installedAt: string, host: any, dirs: any }} */
function readManifest() {
  return readJson(path.join(manifestDir(), "installed.json"), { version: "", installedAt: "", host: null, dirs: {} });
}
function writeManifest(m) {
  ensureDir(manifestDir());
  writeJson(path.join(manifestDir(), "installed.json"), m);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.claudeDir]
 * @param {boolean} [opts.force]
 * @returns {{ ok: boolean, copied: string[], host: any, warnings: string[] }}
 */
export function install(opts = {}) {
  const host = detectHost(opts);
  const warnings = [];
  if (host.app === "unknown") {
    warnings.push("No host agent software detected; files copied to ~/.maw only. Install Claude Code or Codex for full integration.");
  }
  const copied = [];
  /** @type {string[]} every file written (manifest v2 — exact uninstall) */
  const written = [];
  const claudeDir = opts.claudeDir ?? path.join(os.homedir(), ".claude");

  // Claude Code: copy commands + agents + skills + hooks into user dirs.
  if (exists(claudeDir) || opts.force) {
    ensureDir(claudeDir);
    const cmdsSrc = path.join(PKG_ROOT, "plugin", "commands");
    const cmdsDest = path.join(claudeDir, "commands");
    if (exists(cmdsSrc)) { written.push(...copyTree(cmdsSrc, cmdsDest)); copied.push(`${cmdsDest} (commands)`); }

    const agentsSrc = path.join(PKG_ROOT, "plugin", "agents");
    const agentsDest = path.join(claudeDir, "agents");
    if (exists(agentsSrc)) { written.push(...copyTree(agentsSrc, agentsDest)); copied.push(`${agentsDest} (agents)`); }

    const skillsSrc = path.join(PKG_ROOT, "skills");
    const skillsDest = path.join(claudeDir, "skills");
    if (exists(skillsSrc)) { written.push(...copyTree(skillsSrc, skillsDest)); copied.push(`${skillsDest} (skills)`); }

    const hooksSrc = path.join(PKG_ROOT, "plugin", "hooks");
    const hooksDest = path.join(claudeDir, "hooks");
    if (exists(hooksSrc)) { written.push(...copyTree(hooksSrc, hooksDest)); copied.push(`${hooksDest} (hooks)`); }
  }

  // Also drop skills into ~/.maw/skills so non-Claude hosts can symlink.
  const portableSkillsDest = path.join(manifestDir(), "skills");
  const skillsSrc = path.join(PKG_ROOT, "skills");
  if (exists(skillsSrc)) { written.push(...copyTree(skillsSrc, portableSkillsDest)); copied.push(`${portableSkillsDest} (portable skills)`); }

  // Codex agents (best effort)
  const codexDir = path.join(os.homedir(), ".codex");
  if (exists(codexDir)) {
    const agentsSrc = path.join(PKG_ROOT, "plugin", "agents");
    const codexAgentsDest = path.join(codexDir, "agents");
    if (exists(agentsSrc)) { written.push(...copyTree(agentsSrc, codexAgentsDest)); copied.push(`${codexAgentsDest} (codex agents)`); }
  }

  // Pi Agent. Pi is NOT cc-switch-managed; its config lives in ~/.pi/agent/.
  // Copy skills + prompts into pi's dirs ONLY when pi is the detected host, so
  // a claude/codex host never touches a real ~/.pi/agent. Pi agent files need
  // pi frontmatter, so per-agent .pi/agents/maw-*.md are materialized by
  // configgen (project-level) rather than copied here as claude-format files.
  const piDir = host.app === "pi" && host.homeDir ? host.homeDir : "";
  if (host.app === "pi" && piDir) {
    const skillsSrcPi = path.join(PKG_ROOT, "skills");
    if (exists(skillsSrcPi)) {
      const piSkillsDest = path.join(piDir, "skills");
      written.push(...copyTree(skillsSrcPi, piSkillsDest)); copied.push(`${piSkillsDest} (pi skills)`);
    }
    const cmdsSrcPi = path.join(PKG_ROOT, "plugin", "commands");
    if (exists(cmdsSrcPi)) {
      const piPromptsDest = path.join(piDir, "prompts");
      written.push(...copyTree(cmdsSrcPi, piPromptsDest)); copied.push(`${piPromptsDest} (pi prompts, best-effort format)`);
    }
    copied.push(`${piDir} (pi home)`);
  }

  // DeepSeek Harness (dsh). dsh is NOT cc-switch-managed; its home is
  // $DSH_HOME (~/.dsh). Copy skills into the dsh user skills root (rank-400,
  // never the .system child) ONLY when dsh is the detected host, so a
  // claude/codex/pi host never touches a real ~/.dsh. dsh has no slash-command
  // palette and no named agent-definition surface — role specs stay portable
  // under .maw/agents/ (materialized by configgen) and spawn prompt-driven.
  const dshDir = host.app === "dsh" && host.dshHome ? host.dshHome : "";
  if (host.app === "dsh" && dshDir) {
    const skillsSrcDsh = path.join(PKG_ROOT, "skills");
    if (exists(skillsSrcDsh)) {
      const dshSkillsDest = path.join(dshDir, "skills");
      written.push(...copyTree(skillsSrcDsh, dshSkillsDest)); copied.push(`${dshSkillsDest} (dsh skills)`);
    }
    copied.push(`${dshDir} (dsh home)`);
  }

  const pkg = readJson(path.join(PKG_ROOT, "package.json"), { version: "0.0.0" });
  writeManifest({
    version: pkg.version,
    installedAt: new Date().toISOString(),
    host: { app: host.app, codexPluginInstalled: host.codexPluginInstalled, codexBinary: host.codexBinary, capabilities: hostCapabilities(host) },
    dirs: { claudeDir, codexDir, piDir: host.app === "pi" ? piDir : undefined, dshDir: host.app === "dsh" ? dshDir : undefined },
    files: written,
  });

  return { ok: true, copied, host, warnings };
}

/**
 * Remove everything MAW installed and restore the pre-install state.
 * - manifest v2: every recorded file is removed EXACTLY (including the
 *   non-maw-*-prefixed plugin agents/hooks files); legacy manifests (dirs
 *   only, pre-v2) fall back to the maw- and codex-rescue prefix scan.
 * - recorded host subdirs are pruned when they become empty (never when
 *   non-empty).
 * - configs are KEPT by default; opts.purgeConfig deletes the project's
 *   `.maw/` and `.pi/agents/maw-*.md` (never trellis-*).
 * - trellis-owned files are never touched.
 * @param {{ project?: string, purgeConfig?: boolean }} [opts]
 * @returns {{ ok: boolean, removed: string[], purged: string[], kept: string[] }}
 */
export function uninstall(opts = {}) {
  const m = readManifest();
  const removed = [];
  const purged = [];
  const kept = [];
  const claudeDir = m.dirs?.claudeDir ?? path.join(os.homedir(), ".claude");
  const codexDir = m.dirs?.codexDir ?? path.join(os.homedir(), ".codex");
  const hostDirs = [claudeDir, codexDir, m.dirs?.piDir, m.dirs?.dshDir].filter(Boolean);

  // 1) exact removal of everything the manifest recorded (v2)
  if (Array.isArray(m.files)) {
    for (const f of m.files) {
      if (isFile(f)) { fs.unlinkSync(f); removed.push(f); }
    }
  }

  // 2) prefix-scan safety net — ALWAYS runs, on top of the exact removal:
  //    `update()` rewrites the manifest with the CURRENT package's file list,
  //    so maw-*/codex-rescue files from an OLDER install that no longer ship
  //    would otherwise survive exact-mode uninstall. The scan is conservative
  //    (maw-*/codex-rescue prefix only) and doubles as the legacy fallback for
  //    pre-v2 manifests that have no files[] at all. Documented limitation:
  //    non-prefixed plugin agents/hooks from a legacy install are only caught
  //    when the current manifest records them (they are recorded since v2).
  for (const dir of hostDirs) {
    for (const sub of ["commands", "agents", "skills", "hooks", "prompts"]) {
      const p = path.join(dir, sub);
      if (exists(p)) removeIfOurs(p, removed);
    }
  }

  // 3) prune directories that became empty — ONLY ancestors of removed
  //    paths, and only strict descendants of a recorded host dir (never the
  //    host home itself, never unrelated user dirs).
  const hostRoots = new Set(hostDirs.map((d) => path.resolve(d)));
  const candidates = [...new Set(removed.filter((p) => !p.startsWith("(dir)")).map((p) => path.dirname(path.resolve(p))))];
  for (const start of candidates) {
    let cur = start;
    while (!hostRoots.has(cur)) {
      try {
        if (exists(cur) && fs.readdirSync(cur).length === 0) { fs.rmdirSync(cur); removed.push(`(dir) ${cur}`); }
      } catch {}
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  // 4) portable skills + the manifest itself; prune ~/.maw when empty
  const portable = path.join(manifestDir(), "skills");
  if (exists(portable)) { fs.rmSync(portable, { recursive: true, force: true }); removed.push(portable); }
  const manifestPath = path.join(manifestDir(), "installed.json");
  if (exists(manifestPath)) { fs.unlinkSync(manifestPath); removed.push(manifestPath); }
  try { if (exists(manifestDir()) && fs.readdirSync(manifestDir()).length === 0) fs.rmdirSync(manifestDir()); } catch {}

  // 5) config retention: keep by default, purge on explicit request
  const project = opts.project ? path.resolve(opts.project) : process.cwd();
  const mawDir = path.join(project, ".maw");
  if (opts.purgeConfig) {
    if (exists(mawDir)) { fs.rmSync(mawDir, { recursive: true, force: true }); purged.push(mawDir); }
    const piAgents = path.join(project, ".pi", "agents");
    if (exists(piAgents)) {
      for (const f of fs.readdirSync(piAgents)) {
        if (/^mawf?-.*\.md$/.test(f)) { const p = path.join(piAgents, f); fs.unlinkSync(p); purged.push(p); }
      }
      try { if (fs.readdirSync(piAgents).length === 0) fs.rmdirSync(piAgents); } catch {}
    }
  } else {
    if (exists(mawDir)) kept.push(mawDir);
  }
  return { ok: true, removed, purged, kept };
}

/**
 * Remove only files whose names start with "maw-" (legacy fallback; recursive
 * for skills dirs that we own).
 * @param {string} dir
 * @param {string[]} [removed]
 */
function removeIfOurs(dir, removed = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (!/^(mawf?[-_]|codex-rescue)/.test(name)) continue; // be conservative
      const p = path.join(dir, name);
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(p);
    }
  } catch {}
}

/**
 * Update = reinstall (we never mutate user edits in place; re-copy overwrites
 * only our template files, preserving user-added files).
 * @param {object} [opts]
 */
export function update(opts = {}) {
  return install(opts);
}
