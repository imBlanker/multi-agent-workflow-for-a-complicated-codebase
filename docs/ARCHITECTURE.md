# MAW — Architecture & Theoretical Grounding

> Grounded in `src/planner.js`, `src/graph.js`, `src/cost.js`, `src/pricing.js`,
> `src/ccswitch.js`, `src/codex.js`, and the project `README.md`. Code paths and
> scoring constants are taken from the implementation, not invented.

## 1. Overview

MAW (Multi-Agent Workflow for a complicated codebase) is a **portable, dynamic**
multi-agent workflow system. Given a new complex project, it reads the local
[cc-switch](https://github.com/farion1231/cc-switch) SQLite database, probes the
codebase, and selects an agent architecture — `loop`, `orchestrator-workers`,
`multi-agent`, `graph`, `dynamic`, or `ultracode` — or a **combination** of
them. It then emits per-agent, independently-editable configs, enforces
**real-spend** cost-rate limits, and integrates Codex review through
`codex-plugin-cc`.

The guiding principle is the one stated at the top of `src/planner.js`:

> Start simple; add complexity only when it demonstrably helps.

MAW never hardcodes one topology. It scores each architecture against real
project signals (file count, languages, parallelizable subtasks, risk, context
need, value/cost tolerance, HITL/persistence needs) plus the host's native
capabilities, picks the best fit, and combines others as appropriate. The host
agent software (Claude Code, Codex, …) drives execution; MAW provides the
**plan**, the **cost gate**, and the **review gates**. When the host already
offers a native dynamic-workflow or multi-agent mechanism, MAW layers `dynamic`
on top and lets the host drive — instead of re-implementing coordination.

This is the Anthropic *workflow-vs-agent* distinction made operational: MAW
starts from the simplest workflow that can work and only escalates to agents,
subagents, or full multi-agent breadth when the signals justify the cost.

## 2. The Four Paradigms + Two MAW Modes

MAW composes six selectable architectures. Four are the well-known paradigms;
two (`dynamic`, `ultracode`) are MAW-specific combinations.

| Architecture | One-line definition | When it fits | Cost / complexity |
|---|---|---|---|
| **loop** | A single agent that iterates act→observe→reflect until an exit criterion holds. | Open-ended single task, steps unpredictable, context fits one window. | Low cost, low complexity. One context, one model. |
| **orchestrator-workers** (subagents) | An orchestrator decomposes the task and delegates subtasks to subagents with **their own context windows**, then synthesizes. | Many dynamic parallelizable subtasks, or context that exceeds one window. | Medium. Each subagent pays its own context; orchestrator adds coordination tokens. |
| **multi-agent** | Multiple agents run breadth-first in parallel on independent facets, communicating via a shared bus/memory. | High-value work with many independent parallel directions that tolerates elevated cost. | High. Anthropic's multi-agent research system reports ~15× token cost vs single agent, offset by a 90.2% eval-quality gain. |
| **graph** | A declarative graph of nodes (work) and edges (transitions, including conditional) executed in topological batches with gates. | Predictability, human-in-the-loop, persistence/checkpoints, branching, high risk. | Medium complexity, deterministic and inspectable. |
| **dynamic** (MAW mode) | Layer MAW's plan/cost/review on top of the **host's native** dynamic-workflow/multi-agent runtime; the host drives execution. | The host already provides dynamic-workflow or multi-agent (e.g. Claude Code `Task`). | Lowest coordination overhead — no re-implementation. |
| **ultracode** (MAW mode) | `graph` + `loop` + a Codex fix-gate: checkpoints, an implement→test→fix loop, and a Codex review at the gate. | Complex coding (≥20 files or risk ≥ medium) with `codex-plugin-cc` available. | Highest value/complexity, but risk-gated so review only fires at selected gates. |

**Theoretical grounding.** The *loop* paradigm follows Lilian Weng's
*LLM Powered Autonomous Agents* — the ReAct (reason→act→observe) and Reflexion
(self-reflection) loops. The *orchestrator-workers* pattern and the
workflow-vs-agent distinction come from Anthropic's *Building Effective Agents*;
the multi-agent cost awareness (subagent context compression, ~15× token cost,
~90.2% eval gain) comes from Anthropic's *How we built our multi-agent research
system*. The *graph* paradigm mirrors LangGraph: structure is a graph of nodes
and edges, the path through it can be fully dynamic via conditional edges, and
designated nodes can loop, with first-class persistence and human-in-the-loop —
captured by LangGraph's own framing that "the hard part is context at each step."

## 3. Selection Rubric

The planner (`scoreArchitectures` in `src/planner.js`) is a **deterministic
scoring function** — fully testable, no hidden LLM call. Each architecture earns
points from matching signals; the highest non-`none` score becomes `primary`.

### Signal → architecture mapping (reproduced from README §5, with the *why*)

| Signal | Likely pick | Why (from the scoring code) |
|---|---|---|
| tiny, fixed, low-risk | `none` (single call) | `files ≤ 3 && parallel === 0 && risk ≤ 1 && ctx === "small"` → `none` +100. A single LLM call + retrieval suffices. |
| open-ended, steps unpredictable, one context | `loop` | `ctx !== "large" && risk ≥ 1` → `loop` +45 (+10 if coding). ReAct/Reflexion fits single-window open work. |
| many dynamic parallelizable subtasks / context exceeds one window | `orchestrator-workers` | `parallel ≥ 3 \|\| ctxLarge` → +55 + `min(parallel,6)*4`. Subagents carry their own windows; orchestrator compresses. |
| high-value breadth-first, parallel, tolerate ~15× cost | `multi-agent` | `value ≥ 2 && parallel ≥ 4` → +50 + `value*6` (+10 if research). Worth the ~15× token cost for breadth. |
| need predictability, HITL, persistence, branching | `graph` | `needHITL \|\| needPersistence \|\| risk ≥ 2` → +40 + HITL/persistence/risk bonuses (+12 for migration). Graph gives inspectable, checkpointed control. |
| host has native dynamic workflow / multi-agent | `dynamic` (layered on) | `host.hasDynamicWorkflow \|\| host.hasMultiAgent` → +30. Drive the host's runtime instead of re-implementing. |
| complex coding + Codex review available | `ultracode` | `taskType === "coding" && (files ≥ 20 \|\| risk ≥ 2) && host.codexPluginInstalled` → +45 + bonuses. Graph checkpoints + implement→review→fix loop. |

### How architectures combine

The set is **not exclusive** — `planWorkflow` builds a `selected[]` array from
`primary`:

- `primary === "ultracode"` → `selected = ["graph", "loop", "ultracode"]`. This
  is the canonical combination: a *graph* backbone with checkpoints, a *loop*
  for implement→test→fix, and a Codex review at the fix-gate.
- `primary === "multi-agent"` with `host.hasDynamicWorkflow` →
  `selected = ["dynamic", "multi-agent"]`: `dynamic` is layered on the
  orchestrator-workers topology so the host drives execution natively, while MAW
  keeps the multi-agent breadth.
- `primary === "orchestrator-workers"` with a host that has native dynamic
  workflow → `selected = ["dynamic"]` only: the host *is* the orchestrator;
  MAW supplies plan + cost gate + review, not coordination glue.
- `primary === "graph"` → `selected = ["graph"]` alone (no loop unless `loop`
  was also scored).

So `ultracode = graph + loop + codex fix-gate`, and `dynamic` is layered on
`orchestrator-workers`/`multi-agent` precisely when the host can drive it
natively.

## 4. Engine Modules

Each module is a single responsibility; all are plain ESM with `node:` built-ins
(no runtime npm deps).

| Module | Responsibility (one line) |
|---|---|
| `ccswitch.js` | Read-only access to the cc-switch SQLite DB via `node:sqlite` (`readOnly: true`), falling back to the `sqlite3` CLI; returns providers, `model_pricing`, `settings`, and the real-spend cost rate from `proxy_request_logs`. |
| `pricing.js` | Model price resolution with a documented fallback chain (cc-switch → multiplier → vendored estimate → `null`); `projectRate` is a planning projection only. |
| `planner.js` | The deterministic `scoreArchitectures` + `planWorkflow`: scores six architectures, picks `primary`, builds the `selected[]` set, the agent roster, parallel/serial groups, risk-gated review points, loops, and cost config. |
| `graph.js` | `WorkflowGraph`: nodes/edges, validation (cycles permitted only via explicit `loop` self-edges), `topoBatches()` (Kahn-style parallel batches with `review`/`gate` nodes forcing their own batch, `loop` nodes expanding to `maxIterations`), and `graphFromPlan()`. |
| `configgen.js` | Writes the per-agent, independently-editable `.maw/` files: `workflow.json`, `config.yaml`, `plan.md`, `agents/<role>.md` + `.json`, `graph.json`. |
| `cost.js` | The cost guard: `guard()`/`acquire()`/`release()` enforce **total** rate, **per-session** (per-agent) rate, and concurrency cap, using real spend from `ccswitch.costRate`/`perSessionRate` and a small `.maw/runtime/concurrency.json` state file. |
| `codex.js` | Codex review via the `codex-plugin-cc` companion script (`status`, `runReview`, `shouldReview`); risk-gated, degrades gracefully when codex or the plugin is missing. |
| `installer.js` | Copies the Claude Code plugin (commands/agents/hooks/skills) into host dirs, writes `~/.maw/installed.json`, non-destructive `update`/`uninstall`; best-effort Codex agent copy. |
| `host.js` | Detects the host agent software (`claude-code`/`codex`/`gemini-cli`/`opencode`) and its capabilities (`hasSubagents`, `hasMultiAgent`, `hasDynamicWorkflow`, `hasGraphWorkflow`, `codexPluginInstalled`). |
| `doctor.js` | `maw doctor`: environment + capability report (Node version, cc-switch DB, host, codex status). |
| `probe.js` | Derives workflow signals (`files`, `loc`, `languages`) from a real directory tree, ignoring `node_modules`/`.git`/build dirs; feeds `inferSignals` in the planner. |

## 5. Cost Control

MAW measures the **real inference spend** from cc-switch's
`proxy_request_logs` — `SUM(total_cost_usd)` over a time window divided by the
window in minutes (see `costRate` in `src/ccswitch.js`). This is the
**authoritative** rate. Token-based estimates (`pricing.projectRate`) exist only
for planning/labelling and are never used as the enforcement rate. Real spend is
preferred because it captures actual provider billing multipliers, cache hits,
and retries that token math would miss.

Two **independent** constraints, both enforced in `cost.js`:

- **Per-agent (per-session) rate**: $5.00/min default — a `session_id` exceeding
  it blocks new spawns for that session (a proxy for a single agent run).
- **Total workflow rate**: $10.00/min default — independent of the per-agent sum,
  so four agents each at $0.90/min (under the per-agent cap) still trip the
  $10/min total if their aggregate crosses it.
- **Max concurrency**: 4 default — a hard slot cap in `concurrency.json`.

`guard()` returns `ALLOW` only when total rate < total limit **and** every
session rate < per-agent limit **and** a concurrency slot is free; otherwise it
returns `DENY` with the precise reason. The Claude Code `PreToolUse` hook calls
`guard` before every `Task` spawn.

**Pricing source chain** (used to *label* model prices in configs — never as the
enforcement rate), from `src/pricing.js`:

1. cc-switch `model_pricing` → `source: "cc-switch"`, `estimated: false`.
2. cc-switch provider `cost_multiplier` applied on top →
   `source: "cc-switch:multiplier"`.
3. vendored fallback estimate (`defaults/pricing.fallback.json`) →
   `source: "fallback:estimate"`, `estimated: true`.
4. unknown → `null`. **Never faked as exact.**

When a price is an estimate, configs, `maw cost`, and `maw doctor` say so
explicitly via the `estimated: true` flag.

## 6. Codex Integration

Codex is invoked through the **`codex-plugin-cc` companion script**, discovered
by `findCodexCompanion` under `~/.claude/plugins/marketplaces/openai-codex` (and
the installed cache). `runReview` spawns the companion with `node`, passing
`command` (`review` / `adversarial-review` / `delegate`), `--scope`
(`auto` / `working-tree` / `branch`), `--base`, and `--wait`/`--background`.
Codex's stdout is returned verbatim; MAW parses nothing about Codex's reasoning.

Review is **risk-gated**, not fired on every step. The planner only adds review
points when codex is available **and** risk justifies it:

- `risk ≥ medium` (level ≥ 1) → a `post-implementation` auto-scope review.
- `risk ≥ high` (level ≥ 2) → an additional `working-tree` architecture/security
  review.
- `primary === "ultracode"` → a `branch`-scope **fix-gate** review.

`shouldReview(plan, { after })` confirms at runtime that a matching gate exists
before the runner invokes Codex — so review fires only at the gates the planner
selected.

**Graceful degradation.** When `host.codexPluginInstalled` is false but
`risk ≥ medium` (`riskLevel(signals.risk) >= 2` in `planWorkflow`), the planner
substitutes a **second Claude Code agent** as the reviewer (role `reviewer`,
model `claude`, tools `Read`/`Grep`/`Glob`). The plan still ships a review gate;
it is just not Codex. `codex.status()` reports `ready: false` with the reason
(binary missing vs. companion missing) so `maw doctor` can tell the user exactly
what to install.

## 7. Portability

The plan and per-agent configs are plain **JSON / YAML / Markdown** under
`.maw/`, so any agent software can read them with zero MAW runtime: `workflow.json`
(the plan), `config.yaml` (global knobs), `plan.md` (human guide), `agents/<role>.md`
(portable agent definition) + `<role>.json` (machine config), and `graph.json`
(nodes/edges). Nothing is hardcoded — agents/roles come from the plan, and the
user can add, remove, or edit any file; the runner re-reads it at execute time.

- **Claude Code** gets the full plugin: commands (`/maw:plan`, `/maw:run`,
  `/maw:cost`, `/maw:doctor`, `/maw:add-agent`, `/maw:review`), agent
  definitions, a `PreToolUse` hook that calls the cost guard before each `Task`,
  and portable skills.
- **Codex** gets agent definitions copied to `~/.codex/agents` (best-effort) and
  is invoked as the reviewer via `codex-plugin-cc`.
- **Gemini CLI / opencode / others** read `.maw/` directly; no native glue yet.

Crucially, when the host has a **native** dynamic-workflow or multi-agent
mechanism (`host.hasDynamicWorkflow || host.hasMultiAgent`), MAW layers
`dynamic` on top and lets the host drive execution — MAW provides the plan, the
cost gate, and the review gates, and the host coordinates. MAW never
re-implements coordination the host already does.

## 8. Graceful Degradation Matrix

| Failure / absence | What MAW does | Where it's handled |
|---|---|---|
| Host missing Codex (`codexPluginInstalled: false`), risk ≥ medium | Degrades to a **second Claude Code reviewer** at the same gate; `codex.enabled` stays false. | `planWorkflow` roster branch in `src/planner.js`; `codex.status()` in `src/codex.js` |
| Host missing Codex, risk < medium | No reviewer agent added; workflow runs without a review gate. | `src/planner.js` |
| cc-switch DB missing (`findDb()` → null) | `readCcSwitch` returns empty providers/pricing; models fall back to defaults (`claude-opus-5`, `gpt-5.2-codex`, …); cost rate reads as 0 (no enforcement) and `impl: "none"`. | `src/ccswitch.js` |
| Model unavailable (not in `model_pricing`) | `pricing.resolvePrice` returns the vendored `fallback:estimate` (`estimated: true`), or `null` if also unknown — never faked. Models in the roster fall back to hardcoded ids via `pickModel`. | `src/pricing.js`, `src/planner.js` |
| Pricing source unknown | `null` price; configs/labels show "unknown"; `projectRate` returns `source: "unknown"`. | `src/pricing.js` |
| Concurrency saturated (`running >= maxConcurrency`) | `guard`/`acquire` return `DENY: max concurrency reached`; the PreToolUse hook blocks the spawn until a slot frees. | `src/cost.js` |
| Total rate over limit | `DENY: total cost-rate limit reached` (independent of per-agent). | `src/cost.js` |
| Per-session rate over limit | `DENY: session … >= per-agent limit` for that session. | `src/cost.js` |
| `node:sqlite` binding unavailable (Node < 22.5) | Falls back to the `sqlite3` CLI in JSON mode, still read-only. | `src/ccswitch.js` |

## 9. References

MAW studied these sources and adopted their **ideas**; the implementation is
original (see `NOTICE.md` in the repo for what was borrowed and why).

**Articles / posts**

- Anthropic — *Building Effective Agents*: the workflow-vs-agent distinction and
  the orchestrator-workers pattern. <https://www.anthropic.com/research/building-effective-agents>
- Anthropic — *How we built our multi-agent research system*: subagent context
  compression, ~15× token cost, ~90.2% eval-quality gain, risk-gated evaluation.
  <https://www.anthropic.com/engineering/multi-agent-research-system>
- LangChain / LangGraph — graph-as-nodes-and-edges, declarative structure with
  dynamic conditional paths, persistence and human-in-the-loop.
  <https://blog.langchain.com/langgraph/>
- Lilian Weng — *LLM Powered Autonomous Agents*: the ReAct and Reflexion loops.
  <https://lilianweng.github.io/posts/2023-06-23-agent/>

**Open-source projects (ideas adopted)**

- [`mbruhler/claude-orchestration`](https://github.com/mbruhler/claude-orchestration) (MIT) — multi-agent orchestration plugin layout.
- [`garyqlin/glink-engine`](https://github.com/garyqlin/glink-engine) (MIT) — zero-dependency YAML graph engine + shared event bus.
- [`milanglacier/pi-dynamic-workflow`](https://github.com/milanglacier/pi-dynamic-workflow) (MIT) — dynamic workflow selection.
- [`srijansk/agent-relay`](https://github.com/srijansk/agent-relay) (MIT) — YAML workflow + agent relay.
- [`x-glacier/SwarmFlow`](https://github.com/x-glacier/SwarmFlow) (Apache-2.0) — multi-agent orchestration + cost awareness.
- [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) — the Codex review integration target.
- [star-history](https://github.com/star-history/star-history) — the GitHub Stars trend chart used in the README.

---

*License: MIT. This document is architecture-level prose grounded in the
implementation at the time of writing; where the code and this text disagree,
the code in `src/` is authoritative.*
