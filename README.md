# MAW — Multi-Agent Workflow for Complex Codebases

[![CI](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml/badge.svg)](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-52%20passing-success.svg)](#testing)

> A portable, **dynamic** multi-agent workflow system. For a new complex project, MAW reads your [cc-switch](https://github.com/farion1231/cc-switch) config, probes the codebase, and picks the right agent architecture — *loop*, *orchestrator-workers* (subagents), *multi-agent*, *graph*, *dynamic*, or *ultracode* — or a combination. It generates per-agent, independently-editable configs, enforces **real-spend cost-rate limits**, and integrates **Codex review via `codex-plugin-cc`**.

It does not hardcode one architecture. The host (Claude Code, Codex, …) drives execution; MAW provides the plan, the cost gate, and the review gates.

---

## Table of Contents
1. [Project Goals](#1-project-goals)
2. [When to Use](#2-when-to-use)
3. [System Architecture](#3-system-architecture)
4. [Supported Agent Software](#4-supported-agent-software)
5. [Workflow Selection Mechanism](#5-workflow-selection-mechanism)
6. [Agent & Subagent Configuration](#6-agent--subagent-configuration)
7. [Cost Control Mechanism](#7-cost-control-mechanism)
8. [Installation](#8-installation)
9. [Usage Examples](#9-usage-examples)
10. [Directory Structure](#10-directory-structure)
11. [Security Notes](#11-security-notes)
12. [Known Limitations](#12-known-limitations)
13. [Roadmap](#13-roadmap)
14. [Referenced Projects & Acknowledgements](#14-referenced-projects--acknowledgements)
15. [Contributors](#15-contributors)
16. [Contact](#16-contact)

---

## 1. Project Goals

- **Dynamic, not fixed.** For each project, MAW scores six architectures against real signals (file count, languages, parallelizable subtasks, risk, context need, value/cost tolerance, HITL/persistence needs) plus the host's native capabilities, and selects the best fit — or a combination.
- **Portable.** The plan and per-agent configs are plain JSON/YAML/Markdown that any agent software can read. Claude Code gets a full plugin (commands/agents/hooks/skills); Codex gets agents; others get the portable files.
- **Cost-bounded.** Real inference spend from cc-switch logs, not token estimates. Defaults: **$1/min per agent**, **$10/min total** (independent), max concurrency 4 — all editable.
- **Codex review, risk-gated.** When `codex-plugin-cc` is available, Codex acts as the independent reviewer at risk-based gates — not on every step.
- **Reusable, not copied.** We studied open-source projects (see §14) and adopted their *ideas*; the implementation is original.

## 2. When to Use

- A **new complex project**: `maw init -u <user>` then `maw plan`.
- A single agent is insufficient: many files, multiple languages, high risk, or context that exceeds one window.
- You need **cost-bounded** multi-agent runs with **Codex review gates** and graceful degradation.
- You want predictable, inspectable control (graph) with human-in-the-loop checkpoints.

**When NOT to use:** tiny fixed tasks (a single LLM call + retrieval suffices), or tasks where all agents must share one context with many inter-dependencies (most simple coding tasks — a single loop agent is cheaper).

## 3. System Architecture

```
                 ┌─────────────────────────────────────────────┐
   user/project │  maw plan                                   │
                 │  probe → score architectures → select      │
                 │  generate per-agent configs (.maw/)        │
                 └───────────────┬─────────────────────────────┘
                                 │
        ┌────────────────────────┼──────────────────────────────┐
        ▼                        ▼                              ▼
┌──────────────┐        ┌────────────────┐            ┌──────────────────┐
│ cc-switch    │        │ host agent      │            │ codex-plugin-cc  │
│ (SQLite, RO) │        │ (Claude Code)   │            │ (Codex reviewer) │
│ providers,   │        │ drives execute  │            │ risk-gated       │
│ model_pricing│        │ via Task/delegate│           │ review gates     │
│ request_logs │        └────────┬────────┘            └──────────────────┘
└──────────────┘                 │
        ▲                        ▼
        │              ┌──────────────────────────┐
        │              │ cost guard (pre-spawn)   │
        └──────────────│ $/min per-agent + total, │
                       │ concurrency cap          │
                       └──────────────────────────┘
```

- **Engine** (`src/`): `ccswitch.js` (read-only DB access via `node:sqlite`), `pricing.js` (fallback chain), `planner.js` (architecture selection), `graph.js` (workflow graph), `configgen.js` (per-agent files), `cost.js` (rate limiting), `codex.js` (review integration), `installer.js`, `doctor.js`, `host.js`, `probe.js`.
- **Plugin** (`plugin/`): Claude Code commands (`/maw:plan`, `/maw:run`, `/maw:cost`, `/maw:doctor`, `/maw:add-agent`, `/maw:review`), agent definitions, and a `PreToolUse` hook that calls the cost guard before every `Task` spawn.
- **Skills** (`skills/`): portable skill files (`maw-orchestration`, `maw-planner`, `maw-loop`, `maw-graph`, `maw-cost-guard`).

## 4. Supported Agent Software

| Host | Status | Notes |
|---|---|---|
| **Claude Code** | Full | Commands, agents, hooks, skills; native `Task`/delegate for subagents & multi-agent. |
| **Codex** | Best-effort | Agent definitions copied to `~/.codex/agents`; invoked as reviewer via `codex-plugin-cc`. |
| **Gemini CLI / opencode / others** | Portable | Reads the `.maw/` JSON/YAML/Markdown directly; no native glue yet. |

MAW detects the host automatically (`maw doctor`). When the host has a **native** dynamic-workflow / multi-agent mechanism, MAW layers `dynamic` on top and lets the host drive — instead of re-implementing coordination.

## 5. Workflow Selection Mechanism

The planner scores each architecture (higher = better fit), then picks the top one and combines it with others as appropriate.

| Signal | Likely pick |
|---|---|
| tiny, fixed, low-risk | `none` (single call) |
| open-ended, steps unpredictable, one context | `loop` |
| many dynamic parallelizable subtasks / context exceeds one window | `orchestrator-workers` |
| high-value breadth-first, parallel, tolerate ~15× cost | `multi-agent` |
| need predictability, HITL, persistence, branching | `graph` |
| host has native dynamic workflow / multi-agent | `dynamic` (layered on) |
| complex coding + codex review available | `ultracode` (graph + loop + codex fix-gate) |

These combine, they aren't exclusive. E.g. `ultracode` = `graph` + `loop` + a Codex review gate. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full scoring rubric and the theoretical grounding (Anthropic / LangGraph / Lilian Weng).

## 6. Agent & Subagent Configuration

`maw plan` writes an **independently-editable** config per agent/role under `.maw/`:

```
.maw/
  workflow.json          # full plan (re-read at execute time)
  config.yaml            # global knobs: cost limits, concurrency, pricing sources
  plan.md                # human-readable execution guide
  graph.json             # workflow graph (nodes/edges)
  agents/
    orchestrator.md      # portable agent definition (one per role)
    orchestrator.json    # machine config: model, appType, cost limit, tools, price
    researcher.md / .json
    implementer.md / .json
    reviewer.md / .json  # codex reviewer
  runtime/               # concurrency + cost state (gitignored)
```

Nothing is hardcoded: agents/roles come from the plan. Add/remove dynamically:

```bash
maw add-agent --role static-analyzer --model claude-sonnet-5 --app claude --task "Static analysis pass."
maw remove-agent --role static-analyzer
```

Edit any file directly — the runner re-reads it at execute time.

## 7. Cost Control Mechanism

MAW measures **real inference spend** from cc-switch's `proxy_request_logs` (`total_cost_usd` over a time window → USD/min). This is the authoritative rate, not a token estimate.

- **Per-agent**: $1/min default (a session exceeding it blocks new spawns).
- **Total workflow**: $10/min default (independent of the per-agent sum).
- **Max concurrency**: 4 default.
- All editable in `.maw/config.yaml` or via flags (`--per-agent`, `--total`, `--concurrency`).

**Pricing source chain** (used to *label* model prices in configs):
1. cc-switch `model_pricing` (exact) → 2. cc-switch provider `cost_multiplier` (applied on top) → 3. vendored fallback **estimate** (tagged `estimated: true`) → 4. `null` (never faked as exact).

When the price is an estimate, configs and `maw cost`/`doctor` say so explicitly.

```bash
maw cost     # current rate + top sessions + used% vs limit
maw guard    # ALLOW/DENY a new spawn right now (pre-spawn check)
maw acquire --id <id> --role <r>   # take a slot (refuses if over budget)
maw release --id <id>             # release a slot
```

## 8. Installation

**From npm (published):**
```bash
npx multi-agent-workflow install
```

**From a clone (for development / before publish):**
```bash
git clone https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase.git
cd multi-agent-workflow-for-a-complicated-codebase
npx . install          # or: node bin/maw.js install
```

`install` copies the plugin (commands/agents/hooks/skills) into the host agent software's directories, writes an install manifest to `~/.maw/installed.json`, and runs an environment check. It is non-destructive: `update` overwrites only MAW's own template files and preserves anything else you added.

| Action | Command |
|---|---|
| Install | `npx multi-agent-workflow install` |
| Update | `npx multi-agent-workflow update` |
| Uninstall | `npx multi-agent-workflow uninstall` |
| Initialize a project | `maw init -u <your-name>` |
| Doctor (env check) | `maw doctor` |

## 9. Usage Examples

**Minimal — plan + run a small project:**
```bash
maw init -u alice
maw plan --project .
maw run            # batched execution guidance
maw cost           # real cost rate
```

**Full workflow — a complex, high-risk codebase:**
```bash
# 1. plan with explicit signals (or let MAW probe)
maw plan --project . --task-type coding --risk high --parallel 6 --value high --context large

# 2. before spawning each agent, the host checks the guard
maw guard --project .

# 3. acquire/release slots around each subagent run
maw acquire --id impl-1 --role implementer
#   ... run implementer subagent ...
maw release --id impl-1

# 4. at review gates, invoke Codex (risk-gated)
maw review --after "post-implementation"
```

See [`examples/complex-project-workflow.md`](./examples/complex-project-workflow.md) for an end-to-end walkthrough, and [`examples/.maw-sample/`](./examples/.maw-sample/) for a real generated plan (6 agents: orchestrator + 2 researchers + 2 implementers + codex reviewer).

**Common errors:**
- `cc-switch database not found` → run `maw doctor`; ensure `~/.cc-switch/cc-switch.db` exists or set `CC_SWITCH_DB`.
- `DENY spawn: ... per-agent limit` → a session is over $1/min; lower concurrency or raise `--per-agent`.
- `codex not ready` → install `codex` and `codex-plugin-cc`; MAW then degrades to a second Claude Code reviewer for risk ≥ medium.
- `no workflow.json; run maw plan first` → run `maw plan --project .`.

## 10. Directory Structure

```
.
├── bin/maw.js              # CLI entry
├── src/                    # engine (ccswitch, pricing, planner, graph, cost, codex, …)
├── plugin/                 # Claude Code plugin (commands, agents, hooks, skills)
├── skills/                 # portable skills
├── defaults/               # pricing.fallback.json (estimates, clearly marked)
├── examples/               # sample project + a real generated .maw plan
├── tests/                  # node:test suite (52 tests) + fixture db builder
├── docs/ARCHITECTURE.md    # architecture + theoretical grounding
├── .github/workflows/ci.yml
├── README.md / README.zh-Hans.md / README.zh-Hant.md
└── LICENSE  (MIT)
```

## 11. Security Notes

- MAW reads cc-switch **read-only** (`node:sqlite` in `readOnly: true` mode; never mutates provider data).
- It never writes secrets to logs. `doctor`/`cost` redact auth tokens.
- The Codex review path invokes `codex-plugin-cc`'s companion script; MAW does not embed credentials.
- The `PreToolUse` hook only **blocks** spawns that exceed the cost/concurrency budget — it does not modify tool inputs.
- Before reusing any external code, we checked: license permits reuse, no obvious security risk, no hidden network calls / credential harvesting / dangerous auto-execution. See [`NOTICE.md`](./NOTICE.md).

## 12. Known Limitations

- The cost guard measures **past** spend; a sudden burst can briefly exceed the limit before the next log flush.
- Codex review integration depends on `codex-plugin-cc` being installed; without it, MAW substitutes a second Claude Code reviewer (graceful, but not Codex).
- Per-agent rate limiting is enforced per **session**; agents that share a session id share a budget.
- Graph persistence resumes state within a session; cross-process crash recovery is on the roadmap.
- Not yet published to npm; use `npx . install` from a clone until published.

## 13. Roadmap

- [ ] Publish to npm as `multi-agent-workflow`.
- [ ] Cross-process crash recovery for graph state.
- [ ] LangGraph-style conditional edge evaluation in the runner.
- [ ] Per-agent token-budget projection alongside the spend-based rate.
- [ ] Gemini CLI / opencode native glue.
- [ ] Web UI for live cost + concurrency monitoring.

## 14. Referenced Projects & Acknowledgements

We studied these open-source projects and adopted their **ideas** (workflow scheduling, agent/role management, dynamic workflow generation, graph execution, loop control, cost budgeting, plugin install, multi-agent messaging). The MAW implementation is original; no project was copied wholesale. See [`NOTICE.md`](./NOTICE.md) for what was borrowed and why.

- **Anthropic — *Building Effective Agents*** & ***How we built our multi-agent research system*** — the workflow-vs-agent distinction, the orchestrator-workers pattern, subagent context compression, ~15× token cost awareness, and risk-gated evaluation.
- **LangChain / LangGraph** — graph-as-nodes-and-edges, declarative structure + dynamic paths, persistence/HITL, "the hard part is context at each step".
- **Lilian Weng — *LLM Powered Autonomous Agents*** — ReAct/Reflexion loop and reflection mechanics.
- [`mbruhler/claude-orchestration`](https://github.com/mbruhler/claude-orchestration) (MIT) — multi-agent orchestration plugin layout.
- [`garyqlin/glink-engine`](https://github.com/garyqlin/glink-engine) (MIT) — zero-dependency YAML graph engine + shared event bus.
- [`milanglacier/pi-dynamic-workflow`](https://github.com/milanglacier/pi-dynamic-workflow) (MIT) — dynamic workflow selection.
- [`srijansk/agent-relay`](https://github.com/srijansk/agent-relay) (MIT) — YAML workflow + agent relay.
- [`x-glacier/SwarmFlow`](https://github.com/x-glacier/SwarmFlow) (Apache-2.0) — multi-agent orchestration + cost awareness.
- [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) — the Codex review integration target.
- **star-history** (open source) — the GitHub Stars trend chart (§below).

## 15. Contributors

- **imBlanker** — initial implementation.

> Contributions welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). *(This section is a placeholder; no other contributors are fabricated.)*

## 16. Contact

- Issues: <https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues>
- Author: **imBlanker** (GitHub) — *contact details to be added.*

*(Contact details are intentionally placeholder; no personal email or handle is fabricated.)*

---

## Testing

```bash
npm test        # 52 node:test cases (engine + CLI + installer + codex)
npm run smoke   # maw doctor + maw plan --self-test against this repo
npm run demo    # generate examples/.maw-sample
```

## GitHub Stars Trend

This chart auto-reads the repository's star count and updates itself — no self-hosted statistics service. It is generated by the open-source **[star-history](https://github.com/star-history/star-history)** project.

[![Star History](https://api.star-history.com/svg?repos=imBlanker/multi-agent-workflow-for-a-complicated-codebase&type=Date)](https://star-history.com/#imBlanker/multi-agent-workflow-for-a-complicated-codebase&Date)

---

License: **MIT** — see [`LICENSE`](./LICENSE).
