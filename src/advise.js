// @ts-check
// Deterministic cross-host advising: score every installed host against a
// task profile (requirements text, domain, difficulty) and recommend
// stay/switch with explainable reasons, exact launch commands (dsh gets the
// kill-3080 form), and a pre-created handoff brief on switch.
//
// Policy (parent task 08-20 decisions):
//   D2 — pure deterministic rules; the CALLING agent (an LLM) does semantic
//        synthesis from the structured output + full inventory digest.
//   D3 — recommend + ready handoff; advise NEVER executes launch commands
//        (the only exec is PID resolution for port 3080, injectable/mocked).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { exists, isFile, readJson, writeJson, ensureDir, readText } from "./util.js";
import { parseYamlSubset } from "./util.js";
import { scanInventory } from "./inventory.js";
import { detectHost } from "./host.js";

const DEFAULTS = {
  weights: { capabilityFit: 30, skillMatch: 30, modelFit: 25, costFit: 15 },
  stayBonus: 8,
  margin: 10, // hysteresis: switch only when winner beats current by >= margin
};

const LAUNCH_BINARIES = { "claude-code": "claude", codex: "codex", pi: "pi", dsh: "dsh web" };
const HOST_ALIASES = { claude: "claude-code", "claude-code": "claude-code", codex: "codex", pi: "pi", dsh: "dsh" };

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "for", "with", "on", "is", "are", "be", "this", "that"]);

/**
 * @param {string} text
 * @returns {string[]} unique lowercase tokens (ASCII words + CJK bigrams)
 */
export function tokenize(text) {
  const out = [];
  const low = String(text || "").toLowerCase();
  for (const w of low.match(/[a-z0-9][a-z0-9_\-+.]{1,}/g) || []) {
    if (!STOPWORDS.has(w)) out.push(w);
  }
  for (const seg of low.match(/[\u4e00-\u9fff]+/g) || []) {
    if (seg.length === 1) out.push(seg);
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  }
  return [...new Set(out)];
}

/** @param {() => Date|number} [clock] */
function utc8Now(clock) {
  const base = clock ? new Date(typeof clock === "function" ? clock() : clock) : new Date();
  return new Date(base.getTime() + 8 * 3600 * 1000);
}
/** UTC+8 calendar day "YYYY-MM-DD". @param {() => Date|number} [clock] */
function utc8Day(clock) { return utc8Now(clock).toISOString().slice(0, 10); }
/** UTC+8 stamp "YYYYMMDD-HHmmss". @param {() => Date|number} [clock] */
function utc8Stamp(clock) {
  return utc8Now(clock).toISOString().replace(/-/g, "").replace("T", "-").slice(0, 15);
}

/**
 * Resolve the default current host: MAW_HOST env (mapped), else detectHost().
 * @returns {string}
 */
function defaultCurrentHost() {
  const env = (process.env.MAW_HOST || "").toLowerCase();
  if (HOST_ALIASES[env]) return HOST_ALIASES[env];
  return detectHost().app;
}

/**
 * Read `.maw/config.yaml` → advise overrides {weights?, stayBonus?, margin?}.
 * @param {string} projectDir
 */
function readAdviseConfig(projectDir) {
  const file = path.join(projectDir, ".maw", "config.yaml");
  if (!isFile(file)) return {};
  try {
    const parsed = parseYamlSubset(readText(file));
    const a = parsed?.advise;
    return a && typeof a === "object" ? a : {};
  } catch { return {}; }
}

/**
 * Derive a task profile from project artifacts when --task was not given.
 * @param {string} projectDir
 * @returns {{ text: string, difficulty: number }}
 */
export function deriveTaskProfile(projectDir) {
  let text = "";
  let difficulty = 3;
  const wf = readJson(path.join(projectDir, ".maw", "workflow.json"), null);
  if (wf) {
    const parts = [wf.name, wf.primary, ...(Array.isArray(wf.rationale) ? wf.rationale : [])].filter(Boolean);
    text = parts.join(". ");
    const primary = String(wf.primary || "");
    if (/multi-agent|orchestrator-workers/.test(primary)) difficulty = 4;
    else if (/loop|dynamic/.test(primary)) difficulty = 3;
    else difficulty = 2;
  }
  if (!text) text = "project work (no plan artifacts)";
  return { text, difficulty };
}

/**
 * capabilityFit (≤30): difficulty vs host architecture caps.
 * @param {number} difficulty 1-5
 * @param {string[]} caps host capabilities
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreCapabilityFit(difficulty, caps) {
  const has = (c) => caps.includes(c);
  // need values per difficulty tier (subagents / multi-agent / dynamic-workflow)
  const tier = difficulty >= 4 ? { sub: 22, multi: 30, dyn: 30 }
    : difficulty === 3 ? { sub: 20, multi: 25, dyn: 27 }
    : { sub: 15, multi: 18, dyn: 20 };
  let score = 5; // any host is usable for trivial work
  const reasons = [];
  if (has("subagents")) { score += tier.sub; reasons.push(`subagents cap fits difficulty ${difficulty}`); }
  if (has("multi-agent")) { score += tier.multi; reasons.push(`multi-agent cap fits difficulty ${difficulty}`); }
  if (has("dynamic-workflow")) { score += tier.dyn; reasons.push(`dynamic-workflow cap fits difficulty ${difficulty}`); }
  return { score: Math.min(30, score), reasons };
}

/**
 * skillMatch (≤30): task tokens vs host skills/plugins/MCP names+descriptions.
 * exact name hit 3, name-substring 2, description-substring 1; raw × 2 capped.
 * @param {string[]} tokens
 * @param {any} host inventory host entry
 */
function scoreSkillMatch(tokens, host) {
  const reasons = [];
  const matched = { skills: [], mcps: [], plugins: [] };
  let raw = 0;
  const entries = [
    ...(host.skills || []).map((s) => ({ kind: "skills", name: s.name, desc: s.description || "" })),
    ...(host.plugins || []).map((p) => ({ kind: "plugins", name: p.name, desc: "" })),
    ...(host.mcps || []).map((m) => ({ kind: "mcps", name: m.name, desc: "" })),
  ];
  for (const e of entries) {
    const name = String(e.name || "").toLowerCase();
    const desc = String(e.desc || "").toLowerCase();
    let best = 0;
    for (const t of tokens) {
      if (t === name) { best = Math.max(best, 3); break; }
      if (name.includes(t)) best = Math.max(best, 2);
      else if (desc && desc.includes(t)) best = Math.max(best, 1);
    }
    if (best > 0) {
      raw += best;
      matched[e.kind].push(e.name);
      reasons.push(`${e.kind === "mcps" ? "mcp" : e.kind.slice(0, -1)} match: ${e.name}`);
    }
  }
  return { score: Math.min(30, raw * 2), reasons, matched };
}

/**
 * modelFit (≤25): host models (inventory: family + tags + price) vs task needs.
 * @param {string[]} tokens
 * @param {number} difficulty
 * @param {any} host
 */
function scoreModelFit(tokens, difficulty, host) {
  const models = host.models || [];
  const needs = {
    research: tokens.some((t) => /research|调研|分析|report|报告|survey/.test(t)),
    coding: tokens.some((t) => /code|代码|refactor|重构|实现|implement|bug|fix|test/.test(t)),
  };
  const agentic = difficulty >= 4;
  const suitable = models.filter((m) => {
    const tags = m.tags || [];
    if (needs.coding) return tags.includes("coding") || tags.includes("reasoning");
    if (needs.research) return tags.includes("reasoning") || tags.includes("agentic");
    return true;
  });
  const agenticOk = !agentic || models.some((m) => (m.tags || []).includes("agentic") || (m.tags || []).includes("coding"));
  let score = 0;
  const reasons = [];
  if (models.length === 0) { reasons.push("no models discovered"); score = 0; }
  else if (suitable.length === 0) { reasons.push("no model matches task needs"); score = 5; }
  else {
    score = 15 + Math.min(10, suitable.length * 3);
    reasons.push(`${suitable.length} suitable model(s): ${suitable.slice(0, 3).map((m) => m.id).join(", ")}`);
    if (!agenticOk) { score = Math.min(score, 12); reasons.push("no strong agentic/coding model for high difficulty (capped)"); }
  }
  return { score: Math.min(25, score), reasons, suitable };
}

/**
 * costFit (≤15): cheapest suitable model ratio across hosts; estimates capped.
 * @param {any[]} suitablePerHost map host→suitable models (filled by caller loop)
 */
function scoreCostFit(host, suitable) {
  const prices = (suitable || []).map((m) => m.price).filter(Boolean);
  const reasons = [];
  if (!prices.length) return { score: 8, reasons: ["no price data (costFit neutral-low)"], minCost: null };
  const anyEstimated = prices.some((p) => p.estimated);
  const minCost = Math.min(...prices.map((p) => (p.input_per_m || 0) + (p.output_per_m || 0)));
  // ratio computed by caller (needs cross-host cheapest); base score here
  return { score: 0, reasons, minCost, anyEstimated };
}

/**
 * Resolve the PID holding 127.0.0.1:3080 (dsh web port). Injectable for tests.
 * Default: lsof → ss parse. Returns string pid or null.
 * @param {() => string|null} [resolver]
 */
export function resolveDshPid(resolver) {
  if (resolver) return resolver();
  const sh = (cmd) => {
    try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim(); }
    catch { return ""; }
  };
  const lsof = sh("lsof -ti tcp:3080 2>/dev/null");
  if (lsof && /^\d+$/.test(lsof.split("\n")[0])) return lsof.split("\n")[0];
  const ss = sh("ss -ltnp 2>/dev/null | grep ':3080 '");
  const m = ss.match(/pid=(\d+)/);
  return m ? m[1] : null;
}

/**
 * @param {string} targetHost
 * @param {() => string|null} [pidResolver]
 */
function launchFor(targetHost, pidResolver) {
  if (!targetHost || LAUNCH_BINARIES[targetHost] === undefined) return null;
  if (targetHost === "dsh") {
    const pid = resolveDshPid(pidResolver);
    if (pid) return { command: `kill -9 ${pid} && dsh web`, note: `old dsh instance holds 127.0.0.1:3080 (pid ${pid}) — kill it, then start fresh` };
    return { command: "kill -9 $(lsof -ti tcp:3080) && dsh web", note: "PID unresolved — template form; old dsh instance holds 127.0.0.1:3080" };
  }
  return { command: LAUNCH_BINARIES[targetHost], note: `run in the project directory` };
}

/**
 * Advise: score all hosts, decide stay/switch, resolve launch, pre-create
 * handoff brief on switch, update freshness state.
 * @param {object} [opts]
 * @param {string} [opts.task] task text (else derived from project artifacts)
 * @param {string} [opts.domain]
 * @param {number} [opts.difficulty] 1-5 (else derived)
 * @param {string} [opts.currentHost] default MAW_HOST | detectHost().app
 * @param {string} [opts.projectDir] default cwd
 * @param {any} [opts.inventory] InventoryReport | null → auto-scan
 * @param {any} [opts.config] advise config overrides (else read .maw/config.yaml)
 * @param {() => (Date|number)} [opts.clock] injectable clock
 * @param {() => string|null} [opts.pidResolver] injectable dsh PID resolver
 * @param {boolean} [opts.updateState] default true
 */
export function adviseTask(opts = {}) {
  const projectDir = path.resolve(opts.projectDir ?? process.cwd());
  const cfg = { ...DEFAULTS, ...(opts.config ?? readAdviseConfig(projectDir)) };
  const weights = { ...DEFAULTS.weights, ...(cfg.weights || {}) };
  const stayBonus = Number(cfg.stayBonus ?? DEFAULTS.stayBonus);
  const marginNeeded = Number(cfg.margin ?? DEFAULTS.margin);

  const inventory = opts.inventory ?? scanInventory({ projectDir });
  const profile = opts.task
    ? { text: opts.task, difficulty: Number(opts.difficulty) || 3, domain: opts.domain || "" }
    : (() => {
        const d = deriveTaskProfile(projectDir);
        return { text: opts.task || d.text, difficulty: Number(opts.difficulty) || d.difficulty, domain: opts.domain || "" };
      })();
  const tokens = tokenize(`${profile.text} ${profile.domain}`.trim());
  const currentHost = opts.currentHost ? (HOST_ALIASES[String(opts.currentHost).toLowerCase()] || opts.currentHost) : defaultCurrentHost();

  // per-host scoring
  const usable = (inventory.hosts || []).filter((h) => !h.error);
  const costFits = [];
  const prelim = usable.map((h) => {
    const cap = scoreCapabilityFit(profile.difficulty, h.capabilities || []);
    const skill = scoreSkillMatch(tokens, h);
    const model = scoreModelFit(tokens, profile.difficulty, h);
    const cost = scoreCostFit(h, model.suitable);
    costFits.push({ host: h.app, ...cost });
    return { host: h.app, cap, skill, model, cost, inventoryHost: h };
  });
  const cheapest = Math.min(...costFits.filter((c) => c.minCost != null).map((c) => /** @type {number} */ (c.minCost)));
  const scores = prelim.map((p) => {
    const wSum = weights.capabilityFit + weights.skillMatch + weights.modelFit + weights.costFit;
    const norm = (val, max, w) => (max > 0 ? (val / max) * w : 0);
    let costScore = 0;
    const costReasons = [];
    if (p.cost.minCost != null && Number.isFinite(cheapest) && cheapest > 0) {
      costScore = (cheapest / p.cost.minCost) * weights.costFit;
      if (p.cost.anyEstimated) { costScore = Math.min(costScore, weights.costFit * 0.7); costReasons.push("estimated pricing (capped)"); }
    } else { costScore = weights.costFit * 0.55; costReasons.push("no price data (neutral)"); }
    const breakdown = {
      capabilityFit: Math.round(norm(p.cap.score, 30, weights.capabilityFit)),
      skillMatch: Math.round(norm(p.skill.score, 30, weights.skillMatch)),
      modelFit: Math.round(norm(p.model.score, 25, weights.modelFit)),
      costFit: Math.round(costScore),
    };
    const total = breakdown.capabilityFit + breakdown.skillMatch + breakdown.modelFit + breakdown.costFit;
    const reasons = [...p.cap.reasons, ...p.skill.reasons, ...p.model.reasons, ...p.cost.reasons, ...costReasons];
    return {
      host: p.host,
      total,
      breakdown,
      isCurrent: p.host === currentHost,
      matched: { skills: p.skill.matched.skills, plugins: p.skill.matched.plugins, mcps: p.skill.matched.mcps, models: p.model.suitable.slice(0, 5).map((m) => m.id) },
      reasons,
    };
  });

  // decision with hysteresis
  const withBonus = scores.map((s) => ({ ...s, totalWithStay: s.total + (s.host === currentHost ? stayBonus : 0) }));
  const ranked = [...withBonus].sort((a, b) => b.totalWithStay - a.totalWithStay);
  const winner = ranked[0];
  const current = withBonus.find((s) => s.host === currentHost) || null;
  const margin = current ? winner.totalWithStay - current.totalWithStay : Number.POSITIVE_INFINITY;
  const recommendSwitch = !!winner && winner.host !== currentHost && margin >= marginNeeded;
  const recommendation = recommendSwitch ? "switch" : "stay";
  const target = recommendSwitch ? winner.host : null;

  // handoff brief (switch only)
  let handoffPath = null;
  if (recommendSwitch) {
    handoffPath = writeHandoffBrief({ projectDir, from: currentHost, to: target, profile, clock: opts.clock });
  }

  // freshness state
  let stateUpdated = false;
  if (opts.updateState !== false) {
    stateUpdated = updateAdviseState(projectDir, { recommendation, target }, opts.clock);
  }

  return {
    currentHost,
    task: profile,
    tokens,
    recommendation,
    target,
    margin: Number.isFinite(margin) ? margin : null,
    scores: withBonus.map(({ totalWithStay, ...rest }) => ({ ...rest, stayBonus: totalWithStay - rest.total })),
    launch: recommendSwitch ? launchFor(target, opts.pidResolver) : null,
    handoffPath,
    stateUpdated,
  };
}

/**
 * Write `.maw/handoff/<ts>-<from>-<to>.md` (UTC+8 stamp); keep newest 10.
 * @param {{ projectDir: string, from: string, to: string, profile: any, clock?: any }} o
 */
function writeHandoffBrief(o) {
  const dir = path.join(o.projectDir, ".maw", "handoff");
  ensureDir(dir);
  const ts = utc8Stamp(o.clock);
  const file = path.join(dir, `${ts}-${o.from}-to-${o.to}.md`);
  const body = `# Handoff: ${o.from} → ${o.to} (${ts} UTC+8)

## Task
${o.profile.text}

## Progress so far
(To be filled by the outgoing agent before the human switches: what was done, decisions made, current state.)

## Suggested main-agent role
${suggestedRole(o.projectDir)}

## Relevant files
(List the files this task touches — fill in before switching.)

## Next steps
(Concrete next actions for the incoming agent in ${o.to}.)
`;
  fs.writeFileSync(file, body);
  // retention: keep newest 10
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 10))) fs.rmSync(path.join(dir, old), { force: true });
  } catch {}
  return path.relative(o.projectDir, file);
}

/**
 * Suggested main-agent role from plan artifacts (orchestrator if present).
 * @param {string} projectDir
 */
function suggestedRole(projectDir) {
  const wf = readJson(path.join(projectDir, ".maw", "workflow.json"), null);
  const agents = Array.isArray(wf?.agents) ? wf.agents : [];
  const orch = agents.find((a) => /orchestrat/i.test(String(a?.role || a?.name || "")));
  if (orch) return String(orch.role || orch.name);
  return "orchestrator (default — no plan artifacts found)";
}

/**
 * Update `.maw/runtime/advise-state.json`.
 * @param {string} projectDir
 * @param {{ recommendation: string, target: string|null }} last
 * @param {any} [clock]
 */
function updateAdviseState(projectDir, last, clock) {
  try {
    const dir = path.join(projectDir, ".maw", "runtime");
    ensureDir(dir);
    const file = path.join(dir, "advise-state.json");
    const day = utc8Day(clock);
    const prev = readJson(file, {});
    const state = {
      lastRunAt: new Date().toISOString(),
      lastDayUtc8: day,
      runsToday: prev.lastDayUtc8 === day ? Number(prev.runsToday || 0) + 1 : 1,
      lastRecommendation: last,
    };
    writeJson(file, state);
    return true;
  } catch { return false; }
}

/**
 * Freshness gate for the injected block: STALE when state missing or the
 * last run was on a previous UTC+8 day.
 * @param {string} statePath
 * @param {any} [clock]
 * @returns {"STALE"|"ADVISED_TODAY"}
 */
export function checkFreshness(statePath, clock) {
  const state = exists(statePath) ? readJson(statePath, null) : null;
  if (!state || !state.lastDayUtc8) return "STALE";
  return state.lastDayUtc8 === utc8Day(clock) ? "ADVISED_TODAY" : "STALE";
}

/**
 * Human-readable rendering ending with the stable machine footer
 * `ADVISE-DONE recommendation=… target=… margin=… handoff=…`.
 * @param {any} r AdviseResult
 */
export function renderAdvise(r) {
  const lines = [];
  lines.push(`MAW cross-host advise — current host: ${r.currentHost}`);
  lines.push(`task: ${String(r.task.text).slice(0, 160)}`);
  lines.push(`difficulty: ${r.task.difficulty}${r.task.domain ? ` · domain: ${r.task.domain}` : ""}`);
  lines.push("");
  lines.push("host scores:");
  for (const s of [...r.scores].sort((a, b) => b.total - a.total)) {
    lines.push(`  ${s.host}${s.isCurrent ? " (current)" : ""}: ${s.total} = cap ${s.breakdown.capabilityFit} + skill ${s.breakdown.skillMatch} + model ${s.breakdown.modelFit} + cost ${s.breakdown.costFit}${s.stayBonus ? ` (+${s.stayBonus} stay)` : ""}`);
  }
  lines.push("");
  if (r.recommendation === "switch") {
    const winner = r.scores.find((s) => s.host === r.target);
    lines.push(`RECOMMEND: SWITCH → ${r.target} (margin ${r.margin})`);
    for (const reason of (winner?.reasons || []).slice(0, 6)) lines.push(`  - ${reason}`);
    if (r.launch) {
      lines.push("");
      lines.push(`launch command (run it yourself in the project dir; the agent never executes it):`);
      lines.push(`  ${r.launch.command}`);
      if (r.launch.note) lines.push(`  note: ${r.launch.note}`);
    }
    if (r.handoffPath) {
      lines.push("");
      lines.push(`handoff brief pre-created: ${r.handoffPath} — fill "Progress so far" + "Relevant files" before switching.`);
    }
  } else {
    lines.push(`RECOMMEND: STAY in ${r.currentHost}`);
    const cur = r.scores.find((s) => s.isCurrent);
    for (const reason of (cur?.reasons || []).slice(0, 6)) lines.push(`  - ${reason}`);
    const best = [...r.scores].sort((a, b) => b.total - a.total)[0];
    if (best && best.host !== r.currentHost) lines.push(`  (best alternative ${best.host} at margin ${r.margin} < ${DEFAULTS.margin} needed to suggest switching)`);
  }
  lines.push("");
  lines.push(`full machine picture: .maw/inventory-digest.md (skills/plugins/MCP/models per host)`);
  lines.push(`ADVISE-DONE recommendation=${r.recommendation} target=${r.target || "-"} margin=${r.margin ?? "-"} handoff=${r.handoffPath || "-"}`);
  return lines.join("\n");
}
