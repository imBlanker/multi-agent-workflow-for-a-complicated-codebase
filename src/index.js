// @ts-check
// CLI dispatch for `maw`. All subcommands are plain functions so they can be
// unit-tested without spawning a process.
import fs from "node:fs";
import path from "node:path";
import { readJson, writeText, writeJson, exists, ensureDir, isoNow, slug } from "./util.js";
import { readCcSwitch } from "./ccswitch.js";
import { detectHost, hostCapabilities } from "./host.js";
import { planWorkflow, inferSignals } from "./planner.js";
import { generateConfigs } from "./configgen.js";
import { report as costReport, guard as costGuard, acquire, release } from "./cost.js";
import { install, uninstall, update } from "./installer.js";
import { doctor } from "./doctor.js";
import { runReview, shouldReview, status as codexStatus } from "./codex.js";
import { probeProject } from "./probe.js";
import { WorkflowGraph, graphFromPlan } from "./graph.js";
import { createProjectProfile, readRouting, routingPolicy, applyRouting, readProviderQuota } from "./ccswitch.js";
import { runTrellisInit } from "./trellis.js";
import { snapshotCcSwitch } from "./backup.js";
import { classifyModel, selectModelForRole, candidatesForAppType, baseRole } from "./modelcap.js";

/**
 * Load cc-switch + host context once.
 * @param {object} [opts]
 * @param {string} [opts.dbPath]
 */
function loadCtx(opts = {}) {
  const host = detectHost();
  const cc = readCcSwitch(opts.dbPath ? { dbPath: opts.dbPath } : {});
  if (cc.dbPath) cc.quota = readProviderQuota({ dbPath: cc.dbPath });
  return { host, cc };
}

/** @param {string[]} args @returns {{}} */
function parse(args) {
  const out = { _: /** @type {string[]} */ ([]), flags: /** @type {Record<string,string|boolean>} */ ({}) };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.replace(/^--/, "");
      if (args[i + 1] && !args[i + 1].startsWith("--")) { out.flags[k] = args[++i]; }
      else out.flags[k] = true;
    } else if (a.startsWith("-") && a.length > 1 && !a.startsWith("--")) {
      // short flag, e.g. -u alice
      const k = a.replace(/^-+/, "");
      if (args[i + 1] && !args[i + 1].startsWith("-")) { out.flags[k] = args[++i]; }
      else out.flags[k] = true;
    } else out._.push(a);
  }
  return out;
}

/** @param {{signal?:any, code?:number}} [o] */
function exit0(o) { if (o?.signal) process.kill(process.pid, o.signal); }

/**
 * @param {string[]} argv
 */
export function main(argv = process.argv.slice(2)) {
  const a = parse(argv);
  const cmd = a._[0];
  const f = a._.slice(1);
  const flags = a.flags;
  switch (cmd) {
    case "init": return cmdInit(f, flags);
    case "plan": return cmdPlan(f, flags);
    case "config": return cmdConfig(f, flags);
    case "cost": return cmdCost(f, flags);
    case "guard": return cmdGuard(f, flags);
    case "acquire": return cmdAcquire(f, flags);
    case "release": return cmdRelease(f, flags);
    case "add-agent": return cmdAddAgent(f, flags);
    case "remove-agent": return cmdRemoveAgent(f, flags);
    case "run": return cmdRun(f, flags);
    case "review": return cmdReview(f, flags);
    case "models": return cmdModels(f, flags);
    case "routing": return cmdRouting(f, flags);
    case "install": return cmdInstall(f, flags);
    case "uninstall": return cmdUninstall(f, flags);
    case "update": return cmdUpdate(f, flags);
    case "doctor": return cmdDoctor(f, flags);
    case "graph": return cmdGraph(f, flags);
    case "version": return cmdVersion();
    case "help": case undefined: return cmdHelp();
    default: return cmdUnknown(cmd);
  }
}

/** @param {string} s @param {boolean} [ok] */
function out(s, ok) { process.stdout.write(s + "\n"); if (ok === false) process.exitCode = 1; }

function cmdVersion() { out(`maw ${pkgVersion()}`); }

function pkgVersion() {
  try {
    const p = readJson(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json"), { version: "?" });
    return p.version;
  } catch { return "?"; }
}

function cmdHelp() {
  out(`maw — portable multi-agent workflow system for complex codebases

Usage: maw <command> [options]

Commands:
  init          Snapshot cc-switch, then initialize a .maw/ workspace
  plan          Probe the project and generate a workflow plan + per-agent configs
  models        Show capability-aware model/provider selection per role
  config        Print the effective .maw/config.yaml
  cost          Report current cost rate (USD/min) from cc-switch logs
  guard         Check if a new agent run is allowed under the cost/concurrency budget
  acquire       Acquire a concurrency/cost slot for an agent run
  release       Release an acquired slot
  add-agent     Dynamically add an agent/role to the current plan
  remove-agent  Dynamically remove an agent/role
  run           Emit execution guidance for the current plan (host-driven)
  review        Invoke a Codex review via codex-plugin-cc (when available)
  graph         Print the workflow graph (nodes/edges) + topo batches
  routing       Show the cc-switch local-routing policy (claude on+failover;
                codex on-except-OAuth). Use --fix to apply.
  install       Install the MAW plugin + skills into the host agent software
  uninstall     Remove the MAW plugin + skills
  update        Reinstall (overwrites templates, keeps user edits)
  doctor        Environment + capability check
  version       Print version
  help          This message

Flags (common):
  --project <dir>      project root (default: cwd)
  --db <path>          cc-switch db path override
  --task-type <t>      coding|research|refactor|review|migration|greenfield|ops
  --risk <l>           low|medium|high
  --parallel <n>       parallelizable subtasks estimate
  --per-agent <usd>    per-agent cost-rate limit USD/min (default 5)
  --total <usd>        total workflow cost-rate limit USD/min (default 10)
  --concurrency <n>    max concurrent agents (default 16)
  --self-test          run planner against the maw repo itself (smoke)
`);
}

function cmdUnknown(cmd) {
  out(`unknown command: ${cmd} (try \`maw help\`)`, false);
}

// --- init ---
function cmdInit(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const user = flags.u || flags.user || "";
  if (!user) { out(`init requires -u <user-name> (e.g. maw init -u alice)`, false); return; }
  ensureDir(path.join(project, ".maw", "agents"));
  ensureDir(path.join(project, ".maw", "runtime"));
  const ctx = loadCtx({ dbPath: flags.db });

  // 0) packaged snapshot of ALL cc-switch config BEFORE anything else touches
  //    cc-switch (only reads existing files; creates ~/.cc-switch/maw-backups/)
  const snap = snapshotCcSwitch({ dbPath: ctx.cc.dbPath || flags.db });
  if (snap.ok) out(`Initialized .maw/ in ${project}`), out(`  cc-switch snapshot: ${snap.archive ?? snap.dir} (${snap.files} files, ${snap.totalBytes} bytes, ${snap.impl})`);
  else out(`Initialized .maw/ in ${project}`), out(`  cc-switch snapshot: skipped — ${snap.error}`);
  const plan = planWorkflow(
    { taskType: "greenfield", files: 0, parallelizableSubtasks: 1, risk: "medium", contextNeed: "small", valuePerRun: "medium", description: "init" },
    { host: ctx.host, ccSwitch: ctx.cc, cost: costFrom(flags) }
  );
  generateConfigs(project, plan, ctx.cc);
  writeText(path.join(project, ".maw", "AGENTS.md"), AGENTS_INIT);
  out(`  host: ${ctx.host.app} (caps: ${hostCapabilities(ctx.host).join(", ") || "none"}); supported: Claude Code + Codex only`);
  out(`  cc-switch: ${ctx.cc.dbPath ? "ok (read-only)" : "not found"}; user: ${user}`);
  out(`  primary architecture: ${plan.primary}`);

  // 1) cc-switch project profile (NEW; never touches 默认 profiles)
  if (ctx.cc.dbPath) {
    const profName = `MAW: ${path.basename(project)}${user ? ` (${user})` : ""}`;
    const pr = createProjectProfile({ name: profName, user, dbPath: ctx.cc.dbPath });
    if (pr.ok) {
      out(`  cc-switch project: ${pr.created ? `created "${profName}" (${pr.id})` : `reused "${profName}"`}` + (pr.protectedDefaults?.length ? `; protected 默认 profiles: ${pr.protectedDefaults.join(", ")}` : ""));
    } else {
      out(`  cc-switch project: not created — ${pr.error}`, false);
    }
  }

  // 2) routing policy check (read-only; --fix-routing applies the carve-out)
  if (ctx.cc.dbPath) {
    const routing = readRouting({ dbPath: ctx.cc.dbPath });
    const pol = routingPolicy(routing);
    if (pol.compliant) {
      out(`  routing policy: compliant (claude local-routing+failover on; codex ${pol.codexOAuthInUse ? "OFF (OAuth)" : "ON"})`);
    } else {
      out(`  routing policy: NOT compliant — ${pol.violations.length} violation(s):`);
      for (const v of pol.violations) out(`    - ${v.app}.${v.field}: expected ${v.expected}, actual ${v.actual}${v.reason ? ` (${v.reason})` : ""}`);
      if (flags["fix-routing"]) {
        const ar = applyRouting({ dbPath: ctx.cc.dbPath, fix: true });
        if (ar.ok) { out(`  routing applied: ${ar.applied.join("; ")}`); }
        else out(`  routing fix failed: ${ar.error}`, false);
      } else {
        out(`    run \`maw routing --fix\` to apply (writes ONLY proxy_config for claude/codex)`);
      }
    }
  }

  // 3) trellis init -u <user> as the mandatory next step (unless --no-trellis)
  if (flags["no-trellis"]) {
    out(`  trellis init: skipped (--no-trellis). Next step: run \`trellis init -u ${user}\`.`);
    return;
  }
  out(`  next step: trellis init -u ${user} (chained automatically)`);
  const tr = runTrellisInit({ project, user, nonInteractive: !process.stdin.isTTY });
  if (tr.stdout) process.stdout.write(tr.stdout);
  if (tr.stderr && !tr.ok) process.stderr.write(tr.stderr);
  out(`  trellis init: ${tr.ok ? "ok" : (tr.code == null ? "interrupted" : `exit ${tr.code}`)} (via ${tr.via}); log: ${path.relative(project, tr.logPath)}`);
  if (tr.conflicts.length) {
    out(`  ⚠ ${tr.conflicts.length} conflict(s) between MAW and trellis detected (see log):`, false);
    for (const c of tr.conflicts.slice(0, 10)) out(`    - ${path.relative(project, c.file)} (${c.kind})`);
    out(`    re-run \`maw plan --project ${project}\` to regenerate MAW's side, or \`trellis init -u ${user}\` to resume trellis`);
  }
}

// --- models ---
/** @param {import("./modelcap.js").Caps} caps */
function capLine(caps) {
  const mark = (v) => (v === true ? "✓" : v === false ? "✗" : "?");
  return `agentic${mark(caps.agentic)} reasoning${mark(caps.reasoning)} coding${mark(caps.coding)} vision${mark(caps.visionIn)}`;
}
function cmdModels(f, flags) {
  const ctx = loadCtx({ dbPath: flags.db });
  if (!ctx.cc.dbPath) { out(`cc-switch database not found`, false); return; }
  const appType = flags.app || "claude";
  const cands = candidatesForAppType(ctx.cc, appType);
  out(`Model capability view — curated catalog, estimated (dimensions mirror the artificialanalysis.ai model leaderboards: intelligence / coding / math / agentic / multimodal-vision / image / image-edit / video / tts / stt)`);
  out(`Available ${appType} provider models (${cands.length}):`);
  for (const c of cands) {
    const cls = classifyModel(c.model);
    const q = ctx.cc.quota?.providers?.[c.providerId] ?? {};
    out(`  ${c.providerName}${c.isCurrent ? " (current)" : ""}: ${c.model} — ${cls.family}; ${capLine(cls.caps)}${q.remainingTodayUsd != null ? `; quota today $${q.remainingTodayUsd}` : "; quota unknown"}${q.ratePerMin ? `; rate $${q.ratePerMin}/min` : ""}`);
  }
  out(`\nRole assignments (capability fit → provider remaining quota/balance → cost rate):`);
  const roles = flags.role ? [flags.role] : ["orchestrator", "researcher", "implementer", "researcher-2", "reviewer"];
  for (const role of roles) {
    const at = baseRole(role) === "reviewer" && appType !== "codex" ? appType : appType;
    const sel = selectModelForRole({ role, appType: at, cc: ctx.cc, quota: ctx.cc.quota, preferCheap: /-2$/.test(role) });
    if (!sel) { out(`  ${role}: no available candidates for app_type "${at}"`); continue; }
    out(`  ${role} → ${sel.providerName} / ${sel.model} (fit ${sel.capabilityScore}/100${sel.quota?.remainingTodayUsd != null ? `, quota today $${sel.quota.remainingTodayUsd}` : ", quota unknown"}${sel.price ? `, $${sel.price.input_per_m}/$${sel.price.output_per_m} per M${sel.price.estimated ? " est." : ""}` : ""})`);
    for (const al of sel.alternates) out(`    alt: ${al.providerName} / ${al.model} (fit ${al.capabilityScore})`);
  }
}

// --- routing ---
function cmdRouting(f, flags) {
  const ctx = loadCtx({ dbPath: flags.db });
  if (!ctx.cc.dbPath) { out(`cc-switch database not found`, false); return; }
  const routing = readRouting({ dbPath: ctx.cc.dbPath });
  const pol = routingPolicy(routing);
  out(`cc-switch routing policy (claude: local-routing+auto-failover always ON; codex: OFF when OpenAI-OAuth, else ON)`);
  out(`  codex OAuth login in use: ${pol.codexOAuthInUse}`);
  out(`  claude: routing ${routing.claude?.enabled ? "on" : "off"}, failover ${routing.claude?.autoFailoverEnabled ? "on" : "off"} (queue: ${pol.claudeFailoverProviders.join(", ") || "none"})`);
  out(`  codex:  routing ${routing.codex?.enabled ? "on" : "off"} (queue: ${pol.codexFailoverProviders.join(", ") || "none"})`);
  if (pol.compliant) { out(`  status: compliant ✓`); return; }
  out(`  status: NOT compliant — ${pol.violations.length} violation(s):`);
  for (const v of pol.violations) out(`    - ${v.app}.${v.field}: expected ${v.expected}, actual ${v.actual}${v.reason ? ` — ${v.reason}` : ""}`);
  if (flags.fix) {
    const ar = applyRouting({ dbPath: ctx.cc.dbPath, fix: true });
    if (ar.ok) { out(`  applied: ${ar.applied.join("; ")}`); out(`  ${ar.note}`); }
    else out(`  fix failed: ${ar.error}`, false);
  } else {
    out(`  run \`maw routing --fix\` to apply (writes ONLY proxy_config for claude/codex; never touches profiles/providers)`);
  }
}

// --- plan ---
function cmdPlan(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const ctx = loadCtx({ dbPath: flags.db });
  let signals;
  if (flags["self-test"]) {
    const probe = probeProject(path.dirname(new URL(import.meta.url).pathname));
    signals = inferSignals(probe);
  } else if (exists(project) && !flags.taskType) {
    const probe = probeProject(project);
    signals = inferSignals(probe);
  } else {
    signals = {
      taskType: flags["task-type"] || "coding",
      parallelizableSubtasks: Number(flags.parallel) || 2,
      risk: flags.risk || "medium",
      contextNeed: flags.context || "medium",
      valuePerRun: flags.value || "medium",
      files: Number(flags.files) || 10,
    };
  }
  if (flags["task-type"]) signals.taskType = flags["task-type"];
  if (flags.parallel) signals.parallelizableSubtasks = Number(flags.parallel);
  if (flags.risk) signals.risk = flags.risk;
  if (flags.context) signals.contextNeed = flags.context;
  if (flags.value) signals.valuePerRun = flags.value;
  if (flags["max-iter"]) signals.maxIterations = Number(flags["max-iter"]);
  if (flags.hitl) signals.needHITL = true;
  if (flags.persistence) signals.needPersistence = true;
  signals.description = flags.description || path.basename(project);

  const plan = planWorkflow(signals, { host: ctx.host, ccSwitch: ctx.cc, cost: costFrom(flags) });
  const gen = generateConfigs(project, plan, ctx.cc);
  const outDir = flags.out ? path.resolve(flags.out) : path.join(project, ".maw");
  if (flags.out) {
    const g = generateConfigs(project, plan, ctx.cc, { outDir: flags.out });
    out(`plan written to ${outDir} (${g.files.length} files)`);
    if (g.warnings.length) { out(`  warnings:`); for (const w of g.warnings) out(`    - ${w}`); }
  } else {
    out(`plan: ${plan.primary} (${plan.selected.join(", ")})`);
    out(`  agents: ${plan.agents.map((a) => `${a.role}(${a.agent})`).join(", ")}`);
    out(`  review gates: ${plan.reviewPoints.length}`);
    out(`  loops: ${plan.loops.length}`);
    out(`  cost: $${plan.cost.perAgentLimitUsdPerMin}/min per agent, $${plan.cost.totalLimitUsdPerMin}/min total, max ${plan.cost.maxConcurrency} concurrent`);
    out(`  written: ${gen.files.length} files to ${gen.dir}`);
    if (gen.warnings.length) { out(`  warnings:`); for (const w of gen.warnings) out(`    - ${w}`); }
  }
}

// --- config ---
function cmdConfig(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const p = path.join(project, ".maw", "config.yaml");
  if (!exists(p)) { out(`no config at ${p}; run \`maw plan\` first`, false); return; }
  out(fs.readFileSync(p, "utf8"));
}

// --- cost ---
function cmdCost(f, flags) {
  const ctx = loadCtx({ dbPath: flags.db });
  const cfg = costCfgFrom(flags, ctx);
  const r = costReport(cfg);
  out(`Cost rate over last ${Math.round(r.windowSeconds/60)} min (impl: ${r.impl})`);
  out(`  total: ${r.total.ratePerMin} USD/min  (limit ${r.total.limitUsdPerMin}, ${r.total.usedPct}% used; spend $${r.total.totalUsd} across ${r.total.requestCount} requests)`);
  out(`  per-agent limit: $${r.perAgentLimitUsdPerMin}/min; max concurrency: ${r.maxConcurrency}`);
  if (r.topSessions.length) {
    out(`  top sessions:`);
    for (const s of r.topSessions) out(`    ${s.sessionId?.slice(0,12)} ${s.appType} ${s.model}: ${s.ratePerMin} USD/min, ${s.requestCount} reqs`);
  }
}

// --- guard ---
function cmdGuard(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const ctx = loadCtx({ dbPath: flags.db });
  const cfg = costCfgFrom(flags, ctx);
  const stateDir = path.join(project, ".maw", "runtime");
  const g = costGuard(stateDir, cfg);
  // guard is a status query: exit 0 in both cases so callers parse output.
  out(g.allowed ? `ALLOW spawn: ${g.remainingConcurrency} slots free, rate ${g.totalRatePerMin}/${g.totalLimitUsdPerMin} USD/min` : `DENY spawn: ${g.reason} (rate ${g.totalRatePerMin}/${g.totalLimitUsdPerMin}, ${g.remainingConcurrency}/${g.maxConcurrency} free)`);
}

// --- acquire/release ---
function cmdAcquire(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const ctx = loadCtx({ dbPath: flags.db });
  const cfg = costCfgFrom(flags, ctx);
  const stateDir = path.join(project, ".maw", "runtime");
  const agentId = flags.id || `agent-${Math.random().toString(36).slice(2, 8)}`;
  const r = acquire(stateDir, cfg, { agentId, role: flags.role || "worker", appType: flags.app });
  out(JSON.stringify(r));
}
function cmdRelease(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const stateDir = path.join(project, ".maw", "runtime");
  const r = release(stateDir, { agentId: flags.id });
  out(JSON.stringify(r));
}

// --- add/remove agent ---
function cmdAddAgent(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const wfPath = path.join(project, ".maw", "workflow.json");
  if (!exists(wfPath)) { out(`no workflow.json; run \`maw plan\` first`, false); return; }
  const plan = readJson(wfPath);
  const role = flags.role || `agent-${plan.agents.length + 1}`;
  if (plan.agents.some((a) => a.role === role)) { out(`role ${role} already exists`, false); return; }
  plan.agents.push({
    role,
    agent: flags.agent || "claude-code",
    model: flags.model || "claude-sonnet-5",
    appType: flags.app || "claude",
    costRateLimitUsdPerMin: Number(flags["per-agent"]) || plan.cost.perAgentLimitUsdPerMin,
    concurrency: Number(flags.concurrency) || 1,
    tools: (flags.tools || "Read,Edit,Bash").split(","),
    reviewRequired: flags.review === true || flags.review === "true",
    task: flags.task || "Contributor agent added dynamically.",
  });
  const ctx = loadCtx({ dbPath: flags.db });
  const gen = generateConfigs(project, plan, ctx.cc);
  out(`added agent ${role}; regenerated ${gen.files.length} files`);
}
function cmdRemoveAgent(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const wfPath = path.join(project, ".maw", "workflow.json");
  if (!exists(wfPath)) { out(`no workflow.json`, false); return; }
  const plan = readJson(wfPath);
  const role = flags.role;
  const before = plan.agents.length;
  plan.agents = plan.agents.filter((a) => a.role !== role);
  if (plan.agents.length === before) { out(`role ${role} not found`, false); return; }
  // remove its files
  const base = path.join(project, ".maw", "agents", slug(role));
  for (const ext of [".md", ".json"]) if (exists(base + ext)) fs.unlinkSync(base + ext);
  const ctx = loadCtx({ dbPath: flags.db });
  generateConfigs(project, plan, ctx.cc);
  out(`removed agent ${role}`);
}

// --- run ---
function cmdRun(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const wfPath = path.join(project, ".maw", "workflow.json");
  if (!exists(wfPath)) { out(`no workflow.json; run \`maw plan\` first`, false); return; }
  const plan = readJson(wfPath);
  const g = graphFromPlan({ ...plan, name: plan.name });
  const { batches, notes } = g.topoBatches();
  out(`Execution guide for ${plan.name} (primary: ${plan.primary})`);
  out(`Host: ${plan.hostApp}; capabilities: ${(plan.hostCapabilities||[]).join(", ")}`);
  batches.forEach((b, i) => {
    out(`\nBatch ${i + 1} ${b.length > 1 ? "(parallel)" : ""}:`);
    for (const n of b) out(`  - ${n.id} [${n.kind}] ${n.role || ""} — ${n.description || ""}`);
  });
  if (notes.length) { out(`\nnotes:`); for (const n of notes) out(`  - ${n}`); }
  out(`\nBefore each spawn, run: maw guard${flags.project ? ` --project ${flags.project}` : ""}`);
  out(`Acquire/release slots with: maw acquire --id <id>; maw release --id <id>`);
}

// --- review ---
function cmdReview(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const wfPath = path.join(project, ".maw", "workflow.json");
  let plan = null;
  if (exists(wfPath)) plan = readJson(wfPath);
  const cs = codexStatus();
  if (!cs.ready) { out(`codex not ready: ${cs.reason}`, false); return; }
  const dec = plan ? shouldReview(plan, { after: flags.after || "post-implementation" }) : { review: true, scope: flags.scope || "auto" };
  if (flags.force !== true && dec.review === false) { out(`no review gate matched (run with --force to review anyway): ${dec.reason}`); return; }
  const r = runReview({
    command: flags.command || "review",
    scope: dec.scope || flags.scope,
    base: flags.base,
    mode: flags.mode === "background" ? "background" : "wait",
  });
  if (r.stdout) out(r.stdout);
  if (r.stderr && !r.ok) out(`[stderr] ${r.stderr}`, false);
  if (!r.ok) out(`review exited with code ${r.code}`, false);
}

// --- graph ---
function cmdGraph(f, flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const wfPath = path.join(project, ".maw", "graph.json");
  if (!exists(wfPath)) { out(`no graph.json; run \`maw plan\` first`, false); return; }
  const g = readJson(wfPath).graph;
  const wf = new WorkflowGraph(g);
  out(JSON.stringify({ nodes: wf.nodes.length, edges: wf.edges.length, validation: wf.validate(), batches: wf.topoBatches().batches.length }, null, 2));
}

// --- install/uninstall/update ---
function cmdInstall(f, flags) {
  const r = install({ force: flags.force });
  out(`installed maw ${pkgVersion()}`);
  for (const c of r.copied) out(`  copied -> ${c}`);
  out(`  host: ${r.host.app} (codex plugin: ${r.host.codexPluginInstalled ? "yes" : "no"})`);
  if (r.warnings.length) for (const w of r.warnings) out(`  ! ${w}`);
}
function cmdUninstall() {
  const r = uninstall();
  out(`uninstalled maw`);
  for (const c of r.removed) out(`  removed: ${c}`);
}
function cmdUpdate(f, flags) {
  const r = update({ force: flags.force });
  out(`updated maw ${pkgVersion()}`);
  for (const c of r.copied) out(`  copied -> ${c}`);
}

// --- doctor ---
function cmdDoctor() {
  const r = doctor();
  out(`maw doctor — ${r.summary}`);
  for (const c of r.checks) out(`  [${c.status.toUpperCase().padEnd(4)}] ${c.name}: ${c.detail}`);
  if (!r.ok) process.exitCode = 1;
}

// --- helpers ---
/** @param {Record<string,string|boolean>} flags */
function costFrom(flags) {
  return {
    perAgent: Number(flags["per-agent"]) || undefined,
    total: Number(flags.total) || undefined,
    maxConcurrency: Number(flags.concurrency) || undefined,
  };
}
/** @param {Record<string,string|boolean>} flags @param {any} ctx */
function costCfgFrom(flags, ctx) {
  const planCost = readPlanCost(flags);
  return {
    perAgentLimitUsdPerMin: Number(flags["per-agent"]) || planCost.perAgent || 5.0,
    totalLimitUsdPerMin: Number(flags.total) || planCost.total || 10.0,
    maxConcurrency: Number(flags.concurrency) || planCost.maxConcurrency || 16,
    windowSeconds: Number(flags.window) || 3600,
    dbPath: flags.db || ctx.cc.dbPath || undefined,
  };
}
/** @param {Record<string,string|boolean>} flags */
function readPlanCost(flags) {
  const project = flags.project ? path.resolve(flags.project) : process.cwd();
  const wf = path.join(project, ".maw", "workflow.json");
  if (exists(wf)) {
    const p = readJson(wf);
    return p.cost || {};
  }
  return {};
}

const AGENTS_INIT = `# MAW Workspace

This directory is generated by \`maw plan\`. Everything here is editable.

- \`workflow.json\` — the full plan (re-read by the runner at execute time)
- \`config.yaml\`   — global knobs: cost limits, concurrency, pricing sources
- \`plan.md\`       — human-readable execution guide
- \`agents/*.md\`    — portable agent definitions (one per role)
- \`agents/*.json\`  — machine configs (model, cost limit, tools)
- \`graph.json\`     — workflow graph (nodes/edges)
- \`runtime/\`       — concurrency + cost state (gitignored)

Re-run \`maw plan\` to regenerate from fresh project signals.
`;
