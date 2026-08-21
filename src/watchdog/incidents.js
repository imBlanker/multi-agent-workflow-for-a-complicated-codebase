// @ts-check
// Watchdog incident records + state machine + persistence.
// One JSON file per incident under <project>/.mawf/watchdog/incidents/;
// ALERTS.md (same dir) collects human-facing alerts. Re-entry-safe: phase
// timeouts are clock-based, so `watchdog --once` invocations (cron) carry
// incidents forward exactly like the resident loop would.
//
// State machine (user decisions 2026-08-21, rounds 1-3):
//   open ──dispatch-a──▶ rescuing-a ──resolved──▶ resolved
//     │                     │ phase-a-timeout / rescue-failed
//     │                     ▼
//     │                 rescuing-b(host[i]) ──resolved──▶ resolved
//     │                     │ all hosts tried
//     │                     ▼
//     │                 human-alert (terminal)
//     ├──budget-stop (terminal, any state, pre-dispatch check)
//     └──original-recovered (any state — signals cleared; running rescues
//         finish their round, no further dispatch)
import fs from "node:fs";
import path from "node:path";
import { exists, readJson, writeJson, ensureDir, isoNow } from "../util.js";

/**
 * @typedef {"open"|"rescuing-a"|"rescuing-b"|"resolved"|"original-recovered"|"human-alert"|"budget-stop"|"diagnose-only"} IncState
 * @typedef {{ phase: "a"|"b", host: string, startedAt: number, endedAt?: number, outcome?: string, spendUsd?: number }} PhaseRec
 * @typedef {{
 *   id: string, projectDir: string, host: string, sessionId: string, file: string,
 *   state: IncState, openedAt: string, updatedAt: string,
 *   finding: { signal: string, reason: string, evidence: string, at: number } | null,
 *   signalsSeen: { signal: string, at: number, reason: string }[],
 *   phases: PhaseRec[], budgetUsd: number, budgetCapUsd: number,
 *   hostsTried: string[], terminalReason?: string,
 * }} Incident
 */

export function watchdogDir(projectDir) {
  return path.join(projectDir, ".mawf", "watchdog");
}
export function incidentsDir(projectDir) {
  return path.join(watchdogDir(projectDir), "incidents");
}
export function alertsFile(projectDir) {
  return path.join(watchdogDir(projectDir), "ALERTS.md");
}

/**
 * @param {string} projectDir
 * @returns {Incident[]}
 */
export function listIncidents(projectDir) {
  const dir = incidentsDir(projectDir);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")); } catch { return []; }
  return names
    .map((n) => readJson(path.join(dir, n), null))
    .filter(Boolean)
    .sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)));
}

/** @param {Incident} inc */
export function saveIncident(inc) {
  const dir = incidentsDir(inc.projectDir);
  ensureDir(dir);
  inc.updatedAt = isoNow();
  writeJson(path.join(dir, `${inc.id}.json`), inc);
  return inc;
}

/** @param {string} projectDir @param {string} id */
export function loadIncident(projectDir, id) {
  return readJson(path.join(incidentsDir(projectDir), `${id}.json`), null);
}

/**
 * @param {{ projectDir: string, host: string, sessionId: string, file: string, finding: Incident["finding"], budgetCapUsd: number, nowSec: number }} args
 * @returns {Incident}
 */
export function openIncident(args) {
  const id = `inc-${args.nowSec}-${Math.random().toString(36).slice(2, 8)}`;
  /** @type {Incident} */
  const inc = {
    id, projectDir: args.projectDir, host: args.host, sessionId: args.sessionId, file: args.file,
    state: "open", openedAt: isoNow(), updatedAt: isoNow(),
    finding: args.finding,
    signalsSeen: args.finding ? [{ signal: args.finding.signal, at: args.finding.at, reason: args.finding.reason }] : [],
    phases: [], budgetUsd: 0, budgetCapUsd: args.budgetCapUsd, hostsTried: [],
  };
  return saveIncident(inc);
}

/**
 * Pure transition. Returns the next state (or null for invalid transitions).
 * Dispatch outcomes are recorded by the caller via phase recs.
 * @param {Incident} inc
 * @param {{ type: "dispatch-a"|"phase-a-timeout"|"dispatch-b"|"resolved"|"original-recovered"|"budget-stop"|"hosts-exhausted"|"diagnose-only", host?: string, nowSec: number, reason?: string }} ev
 * @returns {IncState | null}
 */
export function transition(inc, ev) {
  const S = inc.state;
  switch (ev.type) {
    case "dispatch-a":
      return S === "open" ? "rescuing-a" : null;
    case "phase-a-timeout":
      return S === "rescuing-a" ? "open" : null; // back to open; scan dispatches Phase B next
    case "phase-a-failed":
      return S === "rescuing-a" ? "open" : null; // rescue reported failure (vs window elapsed)
    case "phase-b-failed":
      return S === "rescuing-b" ? "open" : null; // next host gets a chance on the next cycle
    case "dispatch-b":
      return S === "open" ? "rescuing-b" : null;
    case "resolved":
      return S === "rescuing-a" || S === "rescuing-b" ? "resolved" : null;
    case "original-recovered":
      return ["open", "rescuing-a", "rescuing-b"].includes(S) ? "original-recovered" : null;
    case "budget-stop":
      return ["open", "rescuing-a", "rescuing-b"].includes(S) ? "budget-stop" : null;
    case "hosts-exhausted":
      return S === "open" || S === "rescuing-b" ? "human-alert" : null;
    case "diagnose-only":
      return S === "open" ? "diagnose-only" : null; // non-git project: Phase B forbidden
    default:
      return null;
  }
}

/**
 * Apply an event to a loaded incident (transition + bookkeeping + persist).
 * @param {Incident} inc
 * @param {Parameters<typeof transition>[1]} ev
 * @returns {Incident}
 */
export function applyEvent(inc, ev) {
  const next = transition(inc, ev);
  if (next == null) return inc;
  inc.state = next;
  if (ev.reason) inc.terminalReason = ev.reason;
  saveIncident(inc);
  if (next === "human-alert" || next === "budget-stop") {
    appendAlert(inc.projectDir, `- **${next}** \`${inc.id}\` ${inc.host} ${inc.sessionId} — ${ev.reason || inc.finding?.reason || "escalation exhausted"} (${isoNow()})`);
  }
  return inc;
}

/** Human-facing alert log. */
export function appendAlert(projectDir, line) {
  const file = alertsFile(projectDir);
  ensureDir(path.dirname(file));
  const prev = exists(file) ? fs.readFileSync(file, "utf8") : "# Watchdog alerts\n";
  fs.writeFileSync(file, prev.replace(/\n*$/, "\n") + line + "\n");
}

/**
 * Clock-based re-entry reconciliation for a loaded incident: a Phase A/B
 * rescue whose window has elapsed without a recorded outcome counts as
 * failed (rescue-stall), exactly like an in-process timer would.
 * @param {Incident} inc
 * @param {{ nowSec: number, windowSec: number }} args
 * @returns {boolean} true when the incident aged out of a phase
 */
export function reconcilePhaseTimeout(inc, args) {
  const cur = inc.phases[inc.phases.length - 1];
  if (!cur || cur.endedAt) return false;
  if (args.nowSec - cur.startedAt < args.windowSec) return false;
  cur.endedAt = args.nowSec;
  cur.outcome = "window-elapsed";
  const ev = cur.phase === "a"
    ? { type: "phase-a-timeout", nowSec: args.nowSec }
    : { type: "hosts-exhausted", nowSec: args.nowSec, reason: "phase-b window elapsed" };
  applyEvent(inc, ev);
  return true;
}
