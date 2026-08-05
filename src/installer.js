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
 */
function copyTree(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
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
  const claudeDir = opts.claudeDir ?? path.join(os.homedir(), ".claude");

  // Claude Code: copy commands + agents + skills + hooks into user dirs.
  if (exists(claudeDir) || opts.force) {
    ensureDir(claudeDir);
    const cmdsSrc = path.join(PKG_ROOT, "plugin", "commands");
    const cmdsDest = path.join(claudeDir, "commands");
    if (exists(cmdsSrc)) { copyTree(cmdsSrc, cmdsDest); copied.push(`${cmdsDest} (commands)`); }

    const agentsSrc = path.join(PKG_ROOT, "plugin", "agents");
    const agentsDest = path.join(claudeDir, "agents");
    if (exists(agentsSrc)) { copyTree(agentsSrc, agentsDest); copied.push(`${agentsDest} (agents)`); }

    const skillsSrc = path.join(PKG_ROOT, "skills");
    const skillsDest = path.join(claudeDir, "skills");
    if (exists(skillsSrc)) { copyTree(skillsSrc, skillsDest); copied.push(`${skillsDest} (skills)`); }

    const hooksSrc = path.join(PKG_ROOT, "plugin", "hooks");
    const hooksDest = path.join(claudeDir, "hooks");
    if (exists(hooksSrc)) { copyTree(hooksSrc, hooksDest); copied.push(`${hooksDest} (hooks)`); }
  }

  // Also drop skills into ~/.maw/skills so non-Claude hosts can symlink.
  const portableSkillsDest = path.join(manifestDir(), "skills");
  const skillsSrc = path.join(PKG_ROOT, "skills");
  if (exists(skillsSrc)) { copyTree(skillsSrc, portableSkillsDest); copied.push(`${portableSkillsDest} (portable skills)`); }

  // Codex agents (best effort)
  const codexDir = path.join(os.homedir(), ".codex");
  if (exists(codexDir)) {
    const agentsSrc = path.join(PKG_ROOT, "plugin", "agents");
    const codexAgentsDest = path.join(codexDir, "agents");
    if (exists(agentsSrc)) { copyTree(agentsSrc, codexAgentsDest); copied.push(`${codexAgentsDest} (codex agents)`); }
  }

  const pkg = readJson(path.join(PKG_ROOT, "package.json"), { version: "0.0.0" });
  writeManifest({
    version: pkg.version,
    installedAt: new Date().toISOString(),
    host: { app: host.app, codexPluginInstalled: host.codexPluginInstalled, codexBinary: host.codexBinary, capabilities: hostCapabilities(host) },
    dirs: { claudeDir, codexDir },
  });

  return { ok: true, copied, host, warnings };
}

/**
 * Remove the files we installed (by reading the manifest + comparing).
 * @returns {{ ok: boolean, removed: string[] }}
 */
export function uninstall() {
  const m = readManifest();
  const removed = [];
  const claudeDir = m.dirs?.claudeDir ?? path.join(os.homedir(), ".claude");
  for (const sub of ["commands", "agents", "skills", "hooks"]) {
    const p = path.join(claudeDir, sub);
    if (exists(p)) {
      // remove only our maw-* files to avoid nuking user content
      removeIfOurs(p);
    }
  }
  const codexDir = m.dirs?.codexDir ?? path.join(os.homedir(), ".codex");
  const codexAgents = path.join(codexDir, "agents");
  if (exists(codexAgents)) removeIfOurs(codexAgents);
  const portable = path.join(manifestDir(), "skills");
  if (exists(portable)) { fs.rmSync(portable, { recursive: true, force: true }); removed.push(portable); }
  const manifestPath = path.join(manifestDir(), "installed.json");
  if (exists(manifestPath)) { fs.unlinkSync(manifestPath); removed.push(manifestPath); }
  return { ok: true, removed };
}

/**
 * Remove only files whose names start with "maw-" in a dir (non-recursive for
 * commands; recursive for skills dirs that we own).
 * @param {string} dir
 */
function removeIfOurs(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (!/^(maw[-_]|codex-rescue)/.test(name)) continue; // be conservative
      const p = path.join(dir, name);
      fs.rmSync(p, { recursive: true, force: true });
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
