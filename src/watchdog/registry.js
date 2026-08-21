// @ts-check
// Watchdog project registry: which projects does `mawf watchdog` watch?
// Machine-level `~/.mawf/projects.json` (alongside installed.json — the same
// manifest dir), appended by `mawf init` (opt-out: `--no-watchdog`), merged
// with per-config extras/exclusions at resolve time. Pure, injectable paths.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJson, writeJson, ensureDir } from "../util.js";

/**
 * @typedef {{ path: string, addedAt: string, excluded?: boolean }} RegistryEntry
 * @typedef {{ projects: RegistryEntry[] }} Registry
 * @typedef {{ extra?: string[], exclude?: string[] }} WatchdogConfig
 */

/** @param {string} [registryFile] */
export function registryPath(registryFile) {
  return registryFile ?? path.join(os.homedir(), ".mawf", "projects.json");
}

/**
 * @param {string} [registryFile]
 * @returns {Registry}
 */
export function readRegistry(registryFile) {
  const r = readJson(registryPath(registryFile), { projects: [] });
  if (!Array.isArray(r.projects)) r.projects = [];
  return r;
}

/**
 * @param {Registry} reg
 * @param {string} [registryFile]
 */
export function writeRegistry(reg, registryFile) {
  const file = registryPath(registryFile);
  ensureDir(path.dirname(file));
  writeJson(file, reg);
}

/**
 * Register a project (idempotent by resolved path). `excluded` marks
 * opt-outs without deleting history; re-registering an excluded project
 * without the flag clears the exclusion.
 * @param {string} projectDir
 * @param {{ excluded?: boolean, registryFile?: string, now?: () => string }} [opts]
 * @returns {{ registry: Registry, added: boolean }}
 */
export function registerProject(projectDir, opts = {}) {
  const reg = readRegistry(opts.registryFile);
  const resolved = path.resolve(projectDir);
  const existing = reg.projects.find((p) => path.resolve(p.path) === resolved);
  let added = false;
  if (existing) {
    if (opts.excluded) existing.excluded = true;
    else delete existing.excluded;
  } else {
    reg.projects.push({ path: resolved, addedAt: opts.now ? opts.now() : new Date().toISOString(), ...(opts.excluded ? { excluded: true } : {}) });
    added = true;
  }
  writeRegistry(reg, opts.registryFile);
  return { registry: reg, added };
}

/**
 * Resolve the effective watch list: registry ∪ config.extra − exclusions
 * (registry entry `excluded:true` OR config `exclude[]` match). Deduped by
 * resolved path; nonexistent dirs are kept (transient mounts) but flagged.
 * Pure — no IO.
 * @param {Registry} reg
 * @param {WatchdogConfig} [cfg]
 * @param {{ exists?: (p: string) => boolean }} [io]
 * @returns {{ dir: string, exists: boolean }[]}
 */
export function resolveWatchList(reg, cfg = {}, io = {}) {
  const exists = io.exists ?? ((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const excludeSet = new Set((cfg.exclude || []).map((p) => path.resolve(p)));
  /** @type {Map<string, { dir: string, exists: boolean }>} */
  const map = new Map();
  for (const e of reg.projects || []) {
    const dir = path.resolve(e.path);
    if (e.excluded || excludeSet.has(dir)) continue;
    map.set(dir, { dir, exists: exists(dir) });
  }
  for (const p of cfg.extra || []) {
    const dir = path.resolve(p);
    if (excludeSet.has(dir)) continue; // explicit exclude wins over extra
    map.set(dir, { dir, exists: exists(dir) });
  }
  return [...map.values()];
}
