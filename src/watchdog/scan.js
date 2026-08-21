// @ts-check
// Watchdog scan orchestration: registry → active sessions → signals →
// incidents. One `--once` cycle. Reuses (never duplicates):
//   - discoverSessionFiles/parseTail/evaluateSignals  (signals.js)
//   - perSessionRate().errorCount                     (ccswitch.js — signal d)
//   - readRegistry/resolveWatchList                   (registry.js)
//   - incidents state machine                         (incidents.js)
// Stage 2 scope: classify + record ONLY (dispatch lands in Stage 3).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { readJson, writeJson, ensureDir, nowSec, readText, parseYamlSubset } from "../util.js";
import { perSessionRate } from "../ccswitch.js";
import { discoverSessionFiles, parseTail, evaluateSignals, DEFAULT_THRESHOLDS } from "./signals.js";
import { readRegistry, resolveWatchList } from "./registry.js";
import { listIncidents, openIncident, applyEvent, reconcilePhaseTimeout, watchdogDir, loadIncident } from "./incidents.js";
import { dispatchIncident } from "./dispatch.js";
import { readCcSwitch } from "../ccswitch.js";

const TAIL_BYTES = 131072; // last 128 KiB of a transcript is plenty for a/b

/** Read the last `bytes` of a file (returns "" when unreadable). */
function readTail(file, bytes = TAIL_BYTES) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - bytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return ""; }
}

/** Default process-alive probe: any process whose cmdline mentions the dir. */
function processAliveDefault(dir) {
  try {
    const out = execFileSync("pgrep", ["-f", dir], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 5000 });
    return out.trim().length > 0;
  } catch { return false; } // pgrep exit 1 = no match; missing binary = same
}

/**
 * @param {string} projectDir
 * @returns {{ thresholds: any, incidentBudgetUsd: number, hostOrder: string[], intervalMin: number, exclude?: boolean, extra?: string[], webhookUrl?: string }}
 */
export function readWatchdogConfig(projectDir) {
  const file = path.join(projectDir, ".mawf", "config.yaml");
  let cfg = {};
  try { cfg = parseYamlSubset(readText(file)) || {}; } catch { cfg = readJson(file, {}); }
  const w = cfg.watchdog || {};
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...(w.thresholds || {}) },
    incidentBudgetUsd: Number(w.incidentBudgetUsd) || 10,
    hostOrder: Array.isArray(w.hostOrder) && w.hostOrder.length ? w.hostOrder : ["claude", "pi", "dsh", "codex"],
    intervalMin: Number(w.intervalMin) || 15,
    recentSessionMin: Number.isFinite(Number(w.recentSessionMin)) ? Number(w.recentSessionMin) : 60,
    exclude: !!w.exclude, extra: w.extra, webhookUrl: w.webhookUrl,
  };
}

/**
 * One scan cycle.
 * @param {{
 *   registryFile?: string, projectDir?: string, dbPath?: string,
 *   config?: { extra?: string[], exclude?: string[] },
 *   nowSec?: number, isProcessAlive?: (dir: string) => boolean,
 *   fs?: any, homedir?: string,
 * }} [opts]
 */
export function scanOnce(opts = {}) {
  const now = opts.nowSec ?? nowSec();
  const fsh = opts.fs ?? fs;
  const alive = opts.isProcessAlive ?? processAliveDefault;
  const home = opts.home ?? os.homedir();

  const registry = opts.projectDir
    ? { projects: [{ path: opts.projectDir, addedAt: "" }] }
    : readRegistry(opts.registryFile);
  const watchList = resolveWatchList(registry, opts.config || {}, {
    exists: (p) => { try { return fsh.existsSync(p); } catch { return false; } },
  });

  // dispatch is OPT-IN at the scan level: classify+record is the safe default;
  // the CLI turns it on when the user invokes `mawf watchdog`. Keeps library
  // consumers (and tests) hermetic unless they pass a runner.
  const dispatchOn = opts.dispatch === true;
  let ccInfo = null;
  if (dispatchOn) ccInfo = readCcSwitch(opts.dbPath ? { dbPath: opts.dbPath } : {});
  const availableHosts = [
    ["claude", ".claude"], ["pi", path.join(".pi", "agent")], ["dsh", ".dsh"], ["codex", ".codex"],
  ].filter(([, d]) => { try { return fsh.existsSync(path.join(home, d)); } catch { return false; } }).map(([h]) => h);

  // signal-d source: per-session error counts from cc-switch (proxied hosts +
  // pi when cc-switch imports Pi (Session) rows)
  let errBySession = new Map();
  try {
    const per = perSessionRate({ dbPath: opts.dbPath, windowSeconds: 3600 });
    for (const s of per.sessions) errBySession.set(String(s.sessionId), s.errorCount || 0);
  } catch { /* no telemetry — signal d simply absent */ }

  /** @type {any[]} */
  const projectReports = [];
  for (const { dir } of watchList) {
    const cfg = readWatchdogConfig(dir);
    if (cfg.exclude) continue;
    const stateFile = path.join(watchdogDir(dir), "state.json");
    const state = readJson(stateFile, { files: {} });
    state.files = state.files || {};

    const files = discoverSessionFiles({
      projectDir: dir,
      claudeDir: path.join(home, ".claude", "projects"),
      piDir: path.join(home, ".pi", "agent", "sessions"),
      codexDir: path.join(home, ".codex", "sessions"),
      fs: fsh,
    });

    /** @type {any[]} */
    const sessions = [];
    for (const f of files) {
      let st = null;
      try { st = fsh.statSync(f.file); } catch { continue; }
      // "active" sessions only (PRD R1): a transcript untouched for longer
      // than recentSessionMin belongs to a dead/finished session — its old
      // error bursts and permission lines must never open incidents
      // (real-machine lesson: a 54-day-old `requires approval` line tripped
      // signal b on first dry-run)
      if (now - Math.floor(st.mtimeMs / 1000) > cfg.recentSessionMin * 60) continue;
      const prev = state.files[f.file] || {};
      const grew = !prev.size || st.size > prev.size || st.mtimeMs > (prev.mtimeMs || 0);
      const lastGrowthSec = grew ? now : (prev.lastGrowthSec || Math.floor(st.mtimeMs / 1000));
      state.files[f.file] = { size: st.size, mtimeMs: st.mtimeMs, lastGrowthSec };
      const processAlive = alive(dir);
      const tailEntries = parseTail(readTail(f.file));
      const finding = evaluateSignals({
        errorCount: errBySession.get(String(f.sessionId)) ?? 0,
        lastGrowthSec, processAlive, tailEntries,
        nowSec: now, thresholds: cfg.thresholds, host: f.host, sessionId: f.sessionId,
      });
      sessions.push({ ...f, processAlive, lastGrowthSec, finding });
    }

    // reconcile incidents: phase timeouts + original-recovery
    const incidents = listIncidents(dir);
    for (const inc of incidents) {
      reconcilePhaseTimeout(inc, { nowSec: now, windowSec: 15 * 60 });
    }
    // recompute recovery: any incident still open/rescuing whose session now
    // shows NO finding → original-recovered. A session NO LONGER DISCOVERED
    // (host rotated the file away, or filtered as stale) also closes the
    // incident — otherwise a dry-run dispatch on a since-vanished session
    // would sit in rescuing-* forever (real-machine lesson 2026-08-21).
    const activeIncidents = listIncidents(dir).filter((i) => ["open", "rescuing-a", "rescuing-b"].includes(i.state));
    for (const inc of activeIncidents) {
      const sess = sessions.find((s) => s.host === inc.host && s.sessionId === inc.sessionId);
      if (sess && !sess.finding) {
        applyEvent(inc, { type: "original-recovered", nowSec: now, reason: "signals cleared" });
      } else if (!sess) {
        applyEvent(inc, { type: "original-recovered", nowSec: now, reason: "session no longer discovered (rotated/stale)" });
      }
    }

    // open incidents for newly-blocked sessions without one
    let opened = 0;
    for (const s of sessions) {
      if (!s.finding) continue;
      const has = listIncidents(dir).some((i) => ["open", "rescuing-a", "rescuing-b"].includes(i.state) && i.host === s.host && i.sessionId === s.sessionId);
      if (has) continue;
      openIncident({ projectDir: dir, host: s.host, sessionId: s.sessionId, file: s.file, finding: s.finding, budgetCapUsd: cfg.incidentBudgetUsd, nowSec: now });
      opened++;
    }

    // dispatch rescues for OPEN incidents (user-invoked watchdog only)
    let dispatched = [];
    if (dispatchOn) {
      for (const inc of listIncidents(dir).filter((i) => i.state === "open")) {
        try {
          const r = dispatchIncident({
            incident: inc, cc: ccInfo, cfg, available: availableHosts,
            run: opts.run, dryRun: opts.dryRun, workspace: opts.workspace,
            ensureSnap: opts.ensureSnap, log: opts.log,
          });
          if (r.dispatched) dispatched.push({ id: inc.id, ...r });
        } catch (e) {
          (opts.log ?? (() => {}))(`dispatch ${inc.id} error: ${e?.message ?? e}`);
        }
      }
    }

    ensureDir(watchdogDir(dir));
    writeJson(stateFile, state);
    projectReports.push({
      projectDir: dir, sessionsScanned: sessions.length,
      blocked: sessions.filter((s) => s.finding).length, incidentsOpened: opened,
      dispatched,
      activeIncidents: listIncidents(dir).filter((i) => ["open", "rescuing-a", "rescuing-b"].includes(i.state)).map((i) => ({ id: i.id, state: i.state, host: i.host, sessionId: i.sessionId })),
    });
  }

  return {
    at: new Date(now * 1000).toISOString(),
    projects: projectReports,
    blockedTotal: projectReports.reduce((n, p) => n + p.blocked, 0),
  };
}
