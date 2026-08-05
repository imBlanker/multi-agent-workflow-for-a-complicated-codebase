// @ts-check
// Generate per-agent / per-role, independently-editable config files from a
// plan + cc-switch data. Output layout under `.maw/`:
//   .maw/workflow.json          the full plan (machine-readable)
//   .maw/config.yaml           global knobs: cost limits, concurrency, pricing
//   .maw/plan.md               human-readable execution guide
//   .maw/agents/<role>.md       agent definition (portable; works for Claude Code
//                               subagents and as a spec for Codex/other tools)
//   .maw/agents/<role>.json     machine config: model, appType, cost limit, tools
//   .maw/graph.json             the workflow graph (nodes/edges)
//
// Nothing is hardcoded: agents/roles are derived from the plan, and the user
// can add/remove/edit any file. `maw add-agent`/`maw remove-agent` mutate the
// plan and regenerate affected files.
import path from "node:path";
import fs from "node:fs";
import { writeText, writeJson, slug, toYaml, round, exists } from "./util.js";
import { resolvePrice } from "./pricing.js";
import { graphFromPlan, WorkflowGraph } from "./graph.js";

/**
 * @param {string} projectRoot
 * @param {import("./planner.js").Plan} plan
 * @param {{ modelPricing?: Record<string, any>, currentProviders?: Record<string, any> }} ccSwitch
 * @param {{ outDir?: string }} [opts] override output dir (default <projectRoot>/.maw)
 * @returns {{ dir: string, files: string[], warnings: string[] }}
 */
export function generateConfigs(projectRoot, plan, ccSwitch = {}, opts = {}) {
  const maw = opts.outDir ? path.resolve(opts.outDir) : path.join(projectRoot, ".maw");
  const agentsDir = path.join(maw, "agents");
  const files = [];
  const warnings = [];

  // workflow.json
  files.push(writeJson(path.join(maw, "workflow.json"), plan));

  // graph.json
  const g = graphFromPlan({ ...plan, name: plan.name });
  const v = g.validate();
  files.push(writeJson(path.join(maw, "graph.json"), { graph: g.toJSON(), validation: v }));

  // config.yaml — global knobs, all editable
  const costSources = plan.cost.sources.length ? plan.cost.sources : ["cc-switch:unavailable"];
  const configYaml = toYaml({
    workflow: { id: plan.name, primary: plan.primary, selected: plan.selected, host_app: plan.hostApp },
    cost: {
      per_agent_limit_usd_per_min: plan.cost.perAgentLimitUsdPerMin,
      total_limit_usd_per_min: plan.cost.totalLimitUsdPerMin,
      max_concurrency: plan.cost.maxConcurrency,
      window_seconds: 3600,
      pricing_sources: costSources,
    },
    codex: { enabled: plan.codex.enabled, when: plan.codex.when, review_scopes: plan.codex.reviewScopes },
    models: Object.fromEntries(plan.agents.map((a) => [a.role, { model: a.model, app_type: a.appType }])),
    editable: "Every field above is user-editable. Re-run `maw plan` to regenerate from signals.",
  });
  files.push(writeText(path.join(maw, "config.yaml"), configYaml));

  // plan.md — human-readable execution guide
  files.push(writeText(path.join(maw, "plan.md"), planMarkdown(plan, ccSwitch)));

  // per-agent files
  for (const a of plan.agents) {
    const base = path.join(agentsDir, slug(a.role));
    const price = resolvePrice(a.model, {
      modelPricing: ccSwitch.modelPricing,
      costMultiplier: Number(ccSwitch.currentProviders?.[a.appType]?.cost_multiplier ?? 1),
    });
    if (!price) warnings.push(`No price found for ${a.role} model ${a.model}; tagged as unknown. Verify on Artificial Analysis/OpenRouter.`);

    // machine config
    files.push(writeJson(`${base}.json`, {
      role: a.role,
      agent: a.agent,
      app_type: a.appType,
      model: a.model,
      model_selection: a.modelChoice ?? null,
      cost_rate_limit_usd_per_min: a.costRateLimitUsdPerMin,
      concurrency: a.concurrency,
      tools: a.tools,
      review_required: a.reviewRequired,
      task: a.task,
      price: price || { model_id: a.model, source: "unknown", estimated: true, notes: ["Price not found in cc-switch or fallback."] },
      editable: "All fields are independently editable. The runner reads this file at execute time.",
    }));

    // agent definition (portable)
    files.push(writeText(`${base}.md`, agentMarkdown(a, price, plan)));
  }

  // .maw/runtime/ dir for concurrency state
  files.push(writeText(path.join(maw, "runtime", ".keep"), "# concurrency + cost state lives here (gitignored)\n"));

  // prune stale agent files for roles that are no longer in the plan
  try {
    const keep = new Set(plan.agents.map((a) => slug(a.role)));
    for (const f of fs.readdirSync(agentsDir)) {
      const m = f.match(/^(.*)\.(md|json)$/);
      if (m && !keep.has(m[1])) { fs.unlinkSync(path.join(agentsDir, f)); files.push(`(pruned) ${path.join(agentsDir, f)}`); }
    }
  } catch {}

  return { dir: maw, files, warnings };
}

/**
 * @param {import("./planner.js").AgentSpec} a
 * @param {any} price
 * @param {import("./planner.js").Plan} plan
 */
function agentMarkdown(a, price, plan) {
  const priceLine = price
    ? `**Price** (${price.estimated ? "estimated" : "exact"}): ${price.input_per_m}/M in, ${price.output_per_m}/M out — source: \`${price.source}\`${price.notes ? `\n  - ${price.notes.join("\n  - ")}` : ""}`
    : `**Price**: unknown (not in cc-switch or fallback). Treat as estimate.`;
  return `# Agent: ${a.role}

> Part of workflow \`${plan.name}\` (primary: ${plan.primary}). Edit freely; the runner re-reads this file at execute time.

## Identity

- **Role**: ${a.role}
- **Host agent software**: \`${a.agent}\`
- **App type (cc-switch)**: \`${a.appType}\`
- **Model**: \`${a.model}\`
${modelSelectionMd(a)}

## Task

${a.task}

## Tools

${a.tools.map((t) => `- \`${t}\``).join("\n")}

## Cost control

- **Per-agent cost-rate limit**: $${a.costRateLimitUsdPerMin}/min (USD, real inference spend measured from cc-switch logs)
- **Concurrency**: ${a.concurrency}
- **Review required at this agent's output**: ${a.reviewRequired ? "yes" : "no"}

${priceLine}

## How to invoke

${a.agent === "codex" ? `This agent runs via **codex-plugin-cc**. From Claude Code:

\`\`\`bash
node "$CLAUDE_PLUGIN_ROOT/scripts/codex-companion.mjs" review --wait
\`\`\`

or use the slash command \`/codex:review\` (review-only). For adversarial review use \`/codex:adversarial-review\`.` : `Spawn this agent from the orchestrator as a subagent with the tool list above. Pass the task verbatim and require it to return a compressed summary + file diffs.`}
`;
}

/**
 * @param {import("./planner.js").Plan} plan
 * @param {any} ccSwitch
 */
/**
 * Render the "Model selection" block for an agent definition.
 * @param {import("./planner.js").AgentSpec} a
 */
function modelSelectionMd(a) {
  const mc = a.modelChoice;
  if (!mc) return "";
  const lines = [];
  lines.push("## Model selection (capability-aware)");
  lines.push("");
  lines.push(`- **Provider (api key)**: ${mc.provider ?? "(current provider)"}${mc.providerId ? ` (\`${mc.providerId}\`)` : ""} — chosen from ${mc.considered ?? "?"} available candidate(s)`);
  if (mc.capabilityScore != null) lines.push(`- **Capability fit**: ${mc.capabilityScore}/100 for this role`);
  lines.push(`- **Remaining quota (today)**: ${mc.quota?.remainingTodayUsd != null ? `$${mc.quota.remainingTodayUsd}` : "unknown (no daily limit set in cc-switch)"}`);
  if (mc.quota?.ratePerMin != null) lines.push(`- **Provider current spend rate**: $${mc.quota.ratePerMin}/min`);
  lines.push(`- **Estimated**: ${mc.estimated ? "yes (curated capability catalog + cc-switch pricing)" : "no"}`);
  if (mc.reasons?.length) {
    lines.push("- **Why this provider+model**:");
    for (const r of mc.reasons) lines.push(`  - ${r}`);
  }
  if (mc.alternates?.length) {
    lines.push("- **Alternates** (next-best fits):");
    for (const al of mc.alternates) lines.push(`  - ${al.provider ?? "?"} / \`${al.model}\` (fit ${al.capabilityScore ?? "?"})`);
  }
  lines.push("");
  return lines.join("\n");
}

function planMarkdown(plan, ccSwitch) {
  const lines = [];
  lines.push(`# Workflow Plan: ${plan.name}`);
  lines.push(`Generated ${plan.createdAt} on host \`${plan.hostApp}\` (capabilities: ${plan.hostCapabilities.join(", ") || "none"}).`);
  lines.push("");
  lines.push("## Selected architecture");
  lines.push(`- **Primary**: \`${plan.primary}\``);
  lines.push(`- **Combined**: ${plan.selected.map((s) => `\`${s}\``).join(", ")}`);
  lines.push("");
  lines.push("## Rationale");
  for (const r of plan.rationale) lines.push(`- ${r}`);
  lines.push("");
  lines.push("## Agents & roles");
  for (const a of plan.agents) {
    lines.push(`### ${a.role}  (\`${a.agent}\`, model \`${a.model}\`)`);
    lines.push(`- Task: ${a.task}`);
    lines.push(`- Cost-rate limit: $${a.costRateLimitUsdPerMin}/min; concurrency ${a.concurrency}; review required: ${a.reviewRequired}`);
  }
  lines.push("");
  // Model assignments: capability fit -> provider remaining quota -> cost rate.
  if (plan.agents.some((a) => a.modelChoice)) {
    lines.push("## Model assignments (capability-aware)");
    lines.push("Models differ WITHIN a leaderboard (some agentic models are full-multimodal, some are reasoning/dialogue-only, some multimodal models are not agentic), so each role first filters the available provider models by capability fit, then ranks by provider remaining quota/balance and cost rate. Capability data is curated and marked estimated.");
    lines.push("");
    lines.push("| Role | Provider (api key) | Model | Capability fit | Remaining quota today | Price per M (in/out) |");
    lines.push("|---|---|---|---|---|---|");
    for (const a of plan.agents) {
      const mc = a.modelChoice;
      if (!mc) { lines.push(`| ${a.role} | (current) | \`${a.model}\` | — | — | — |`); continue; }
      lines.push(`| ${a.role} | ${mc.provider ?? "(current)"} | \`${a.model}\` | ${mc.capabilityScore ?? "?"}/100 | ${mc.quota?.remainingTodayUsd != null ? "$" + mc.quota.remainingTodayUsd : "unknown"} | ${mc.price ? `$${mc.price.input_per_m}/$${mc.price.output_per_m}${mc.price.estimated ? " est." : ""}` : "unknown"} |`);
    }
    lines.push("");
  }
  lines.push("## Execution order");
  for (const g of plan.groups) {
    lines.push(`### ${g.label} ${g.parallel ? "(parallel)" : "(serial)"}`);
    for (const step of (g.steps || [])) lines.push(`- \`${step.role}\`: ${step.task}`);
  }
  lines.push("");
  lines.push("## Review gates");
  for (const rp of plan.reviewPoints) lines.push(`- ${rp.label || "review"} — by ${rp.by}, scope ${rp.scope}`);
  if (!plan.reviewPoints.length) lines.push("- (none: risk below threshold or codex unavailable)");
  lines.push("");
  lines.push("## Loops");
  for (const lp of plan.loops) lines.push(`- ${lp.label || "loop"} — max ${lp.maxIterations} iterations; exit when ${lp.exitWhen}`);
  if (!plan.loops.length) lines.push("- (none)");
  lines.push("");
  lines.push("## Cost control");
  lines.push(`- Per-agent limit: $${plan.cost.perAgentLimitUsdPerMin}/min (real inference spend from cc-switch proxy_request_logs)`);
  lines.push(`- Total workflow limit: $${plan.cost.totalLimitUsdPerMin}/min (independent constraint; enforced via concurrency + rate gating)`);
  lines.push(`- Max concurrency: ${plan.cost.maxConcurrency}`);
  lines.push(`- Pricing sources: ${plan.cost.sources.join(", ") || "cc-switch unavailable"}`);
  lines.push("");
  lines.push("## Dynamic mutation");
  lines.push("- Add an agent: `maw add-agent --role NAME --model ID --app claude`");
  lines.push("- Remove an agent: `maw remove-agent --role NAME`");
  lines.push("- Re-plan: `maw plan --project .`");
  lines.push("");
  lines.push("Edit any file under `.maw/agents/` directly; the runner reads them at execute time.");
  return lines.join("\n") + "\n";
}
