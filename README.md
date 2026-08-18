[English](./README.md) | [简体中文](./README.zh-Hans.md) | [繁體中文](./README.zh-Hant.md)

[![CI](https://github.com/imBlanker/multi-agents-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/imBlanker/multi-agents-workflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-69%20passing-success.svg)](#testing)
[![GitHub stars](https://img.shields.io/github/stars/imBlanker/multi-agents-workflow?style=social&label=Stars)](https://github.com/imBlanker/multi-agents-workflow/stargazers)

# MAW — Multi-Agent Workflow for Complex Codebases

[Changelog](./CHANGELOG.md)（[简](./CHANGELOG.zh-Hans.md)·[繁](./CHANGELOG.zh-Hant.md)）

> A portable, **dynamic** multi-agent workflow system. For a new complex project, MAW reads your [cc-switch](https://github.com/farion1231/cc-switch) config, probes the codebase, and picks the right agent architecture — *loop*, *orchestrator-workers* (subagents), *multi-agent*, *graph*, *dynamic*, or *ultracode* — or a combination. It generates per-agent, independently-editable configs, enforces **real-spend cost-rate limits**, and integrates **Codex review via [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)**.

> **Note:** formerly `multi-agent-workflow` / repo `multi-agent-workflow-for-a-complicated-codebase`; renamed to an available npm name (the unscoped old name is an unrelated third-party package) and a collision-free command (`mawf`).

> **Supported hosts: Claude Code, Codex, Pi Agent, and DeepSeek Harness (dsh).** Other agent software (Gemini CLI, opencode, …) is intentionally **not** supported. Note: Pi Agent and dsh are NOT cc-switch-managed — pi's config lives in `~/.pi/agent/`; dsh's providers/models live in `~/.dsh/settings.yaml`. Their spend rate is not measured (no proxy), so rate limits degrade to concurrency-only; dsh model prices still come from cc-switch's auto-synced `~/.cc-switch/model-pricing.json` where model ids match.

---

## 🍴 Fork first

**Strongly recommended: fork this repository before you use it.** Make any personal changes in *your* fork, keep it synced with this upstream, and send improvements/insights back here.

- **Fork:** <https://github.com/imBlanker/multi-agents-workflow/fork>
- **Branch naming (Conventional Commits):** `feat/<topic>`, `fix/<issue>`, `docs/<topic>`, `chore/<topic>`, `refactor/<topic>`, `ci/<topic>`, `test/<topic>`.
- **No direct pushes to `main`** — open a Pull Request from your feature branch.
- **One PR per concern**, small and focused; link the issue with `Closes #N`; CI must pass before review.
- **Issues:** search [existing issues](https://github.com/imBlanker/multi-agents-workflow/issues?q=is%3Aissue) first to avoid duplicates, then use the [bug](https://github.com/imBlanker/multi-agents-workflow/issues/new?template=bug_report.md) / [feature](https://github.com/imBlanker/multi-agents-workflow/issues/new?template=feature_request.md) templates.

Full rules in [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md). See [§Contributors](#15-contributors) and [§Contact](#16-contact).

---

## For Humans

> **Tip: you can hand this whole README to your agent and let it install + configure MAW for you — see [For Agents](#for-agents) below.**

MAW is a CLI (`mawf`) plus a Claude Code plugin. The fastest path:

```bash
# 1. Fork the repo (see 🍴 Fork first), then clone YOUR fork:
git clone https://github.com/<you>/multi-agents-workflow.git
cd multi-agents-workflow

# 2. Install the plugin + skills into Claude Code (and Codex, best-effort):
npx . install          # or: node bin/mawf.js install

# 3. Initialize a project (cc-switch project-profile sync is DECOUPLED by default):
mawf init -u <your-name>

# 4. The next step is automatic: MAW runs `trellis init -u <your-name>` for you.
#    (skip the trellis chain with --no-trellis)

# 5. Plan + run:
mawf plan --project .
mawf run
```

If Claude Code routing / auto-failover is off in cc-switch, fix it in one command (writes **only** the `proxy_config` rows for claude/codex — never your profiles/providers):

```bash
mawf routing --fix
```

Check the environment any time: `mawf doctor`.

## For Agents

> **Give this to your agent (Claude Code, Codex, Cursor, …). It will install, configure, and use MAW for the user correctly.**

Fetch the full agent install/configure guide and follow it end to end — do not summarize it:

```bash
curl -fsSL https://raw.githubusercontent.com/imBlanker/multi-agents-workflow/main/docs/AGENT_INSTALL.md
```

The guide covers: fork-and-clone, `npx . install`, `mawf init -u <user>` (creates the cc-switch project profile + checks the routing policy + chains `trellis init`), `mawf plan`, `mawf run`, `mawf cost`, `mawf guard`, `mawf review`, the [For Humans](#for-humans) workflow, the [cc-switch policy](#7-cc-switch-integration--routing-policy), the [trellis init rule](#8-trellis-init-as-the-mandatory-next-step), graceful degradation, and uninstall. Read it in full; do not guess.

Minimal agent prompt: *"Install and configure MAW by following `docs/AGENT_INSTALL.md` in https://github.com/imBlanker/multi-agents-workflow , then run `mawf plan` on this project and report the chosen architecture, agents, and cost limits."*

---

## Table of Contents
1. [Project Goals](#1-project-goals)
2. [When to Use](#2-when-to-use)
3. [System Architecture](#3-system-architecture)
4. [Supported Agent Software](#4-supported-agent-software)
5. [Workflow Selection Mechanism](#5-workflow-selection-mechanism)
6. [Agent & Subagent Configuration](#6-agent--subagent-configuration)
7. [cc-switch Integration & Routing Policy](#7-cc-switch-integration--routing-policy)
8. [trellis init as the Mandatory Next Step](#8-trellis-init-as-the-mandatory-next-step)
9. [Cost Control Mechanism](#9-cost-control-mechanism)
10. [Installation](#10-installation)
11. [Usage Examples](#11-usage-examples)
12. [Directory Structure](#12-directory-structure)
13. [Security Notes](#13-security-notes)
14. [Known Limitations](#14-known-limitations)
15. [Contributors](#15-contributors)
16. [Contact](#16-contact)

## 1. Project Goals
- **Dynamic, not fixed.** MAW scores six architectures against real project signals + host capabilities, and selects the best fit — or a combination. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- **Portable + agent-software-scoped.** Claude Code, Codex, Pi Agent and DeepSeek Harness (narrowed per policy). The plan + per-agent configs are plain JSON/YAML/Markdown the host reads.
- **Cost-bounded.** Real inference spend from cc-switch logs, not token estimates. Defaults: **$5/min per agent**, **$10/min total**, max concurrency 16 — all editable.
- **Capability-aware model choice.** Models differ WITHIN a leaderboard (some agentic models are full-multimodal; some are reasoning/dialogue-only; some multimodal models aren't agentic at all), so each agent/subagent first filters the available provider models by capability fit, then picks provider(api key)+model by remaining quota/balance and cost rate.
- **Codex review, risk-gated.** When [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) is available, Codex acts as the independent reviewer at risk-based gates — not every step.
- **cc-switch-safe + decoupled projects.** All existing cc-switch data is read-only; MAW's **project** feature is DECOUPLED from cc-switch's incomplete `profiles` functionality (code kept, disabled by default; `MAW_CC_PROJECT_SYNC=1` temporarily re-enables it). MAW keeps full authority over project-level agent/subagent model configs (`.maw/agents/*.json`) and only syncs **provider config info** from cc-switch — the high-value settings in each provider's `config.toml`/`config.json` (base_url, model, auth_mode, failover …). Plus the (opt-in) routing carve-out.

## 2. When to Use
A **new complex project**: `mawf init -u <user>` → `mawf plan`. Use when one agent is insufficient (many files, multiple languages, high risk, context exceeds one window) and you need cost-bounded multi-agent runs with Codex review gates. **Don't** use it for tiny fixed tasks (a single loop agent is cheaper).

**Background reading — agent-system concepts.** New to the paradigms MAW scores and selects among? Read the live report — [Agent Architecture Paradigms](https://imblanker.github.io/multi-agents-workflow/agent-architecture-paradigms.html) (rendered on GitHub Pages; source: [`docs/agent-architecture-paradigms.html`](./docs/agent-architecture-paradigms.html)): a short illustrated study distinguishing **Augmented LLM**, **Workflow vs Agent**, **Multi-Agent**, **Subagents**, **Orchestrator-Worker**, **Loop Engineering**, and **Graph Engineering** — what each is, when to use it, and the prerequisites it demands.

## 3. System Architecture
```
   user/project → mawf plan: probe → score architectures → select → generate per-agent configs (.maw/)
        │
   ┌────┴───────────────────────────────────────────────────────┐
   ▼              ▼                                            ▼
 cc-switch      host agent (Claude Code)              codex-plugin-cc (Codex reviewer)
 (SQLite, RO)   drives execute via Task/delegate     risk-gated review gates
 providers,     │
 model_pricing, ▼
 request_logs   cost guard (pre-spawn): $/min per-agent + total, concurrency cap
```
- **Engine** (`src/`): [`ccswitch.js`](./src/ccswitch.js) (read-only provider-config sync + routing; project-profile sync DECOUPLED by default), [`planner.js`](./src/planner.js), [`graph.js`](./src/graph.js), [`configgen.js`](./src/configgen.js), [`cost.js`](./src/cost.js), [`codex.js`](./src/codex.js), [`trellis.js`](./src/trellis.js), [`pricegate.js`](./src/pricegate.js), [`installer.js`](./src/installer.js), [`doctor.js`](./src/doctor.js), [`host.js`](./src/host.js), [`probe.js`](./src/probe.js).
- **Plugin** (`plugin/`): Claude Code commands (`/mawf:plan`, `/mawf:run`, `/mawf:cost`, `/mawf:doctor`, `/mawf:add-agent`, `/mawf:review`), agent definitions, a `PreToolUse` cost-guard hook.
- **Skills** (`skills/`): portable skill files.

## 4. Supported Agent Software
| Host | Status | Notes |
|---|---|---|
| **[Claude Code](https://docs.claude.com/en/docs/claude-code)** | ✅ Full | Commands, agents, hooks, skills; native `Task`/delegate for subagents & multi-agent; **local routing + auto-failover always ON**. |
| **[Codex](https://github.com/openai/codex)** | ✅ Supported | Agent definitions + reviewer via [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc); local routing ON unless OpenAI-OAuth login. |
| **Pi Agent** | ✅ Supported | Config lives in `~/.pi/agent/` (NOT cc-switch); agents → `.pi/agents/maw-*.md`, prompts → pi prompts, skills → `.agents/skills`; spawn via native subagent tool; spend not measured (concurrency-only cost control). |
| **DeepSeek Harness (dsh)** | ✅ Supported | Config lives in `~/.dsh/settings.yaml` (`llm-pi-ai.providers`; NOT cc-switch); no named agent files — portable `.maw/agents/<role>.md` IS the spawn payload via dsh's prompt-driven subagent tool; skills → `$DSH_HOME/skills` + `.agents/skills`; spend rate not measured (concurrency-only), prices from cc-switch's synced `model-pricing.json` where ids match; MCP via dsh patch layers. |
| Gemini CLI / opencode / others | ❌ Not supported | (Their cc-switch pricing may still be READ for cost estimates.) |

`mawf doctor` reports the host + the routing-policy compliance.

## 5. Workflow Selection Mechanism
| Signal | Likely pick |
|---|---|
| tiny, fixed, low-risk | `none` (single call) |
| open-ended, steps unpredictable, one context | `loop` |
| many dynamic parallelizable subtasks / context exceeds one window | `orchestrator-workers` |
| high-value breadth-first, parallel, tolerate ~15× cost | `multi-agent` |
| need predictability, HITL, persistence, branching | `graph` |
| host has native dynamic workflow / multi-agent | `dynamic` (layered on) |
| complex coding + codex review available | `ultracode` (graph + loop + codex fix-gate) |

Architectures **combine** (e.g. `ultracode` = `graph` + `loop` + a Codex review gate). Full rubric: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## 6. Agent & Subagent Configuration
`mawf plan` writes an **independently-editable** config per role under `.maw/` (`workflow.json`, `config.yaml`, `plan.md`, `graph.json`, `agents/<role>.md`+`.json`, `runtime/`). Add/remove dynamically: `mawf add-agent --role <r> ...` / `mawf remove-agent --role <r>`. Edit any file directly — the runner re-reads it at execute time.

**Capability-aware model selection** ([`src/modelcap.js`](./src/modelcap.js), inspired by [Artificial Analysis](https://artificialanalysis.ai)'s ~10 per-capability model leaderboards — intelligence / coding / math / agentic / multimodal-vision / image / image-edit / video / tts / stt). For each role MAW: ① classifies **every available provider model** from cc-switch by capability (a full-multimodal agentic model, a reasoning/dialogue-only agentic model, and a multimodal-but-non-agentic model are three different things), ② drops models unfit for the role (e.g. an image-generation model can never be an implementer), ③ ranks the rest by **capability fit → provider remaining quota/balance → cost rate** (quota = `limit_daily/monthly_usd` − spend in `usage_daily_rollups`; unknown when no limit is set). The curated catalog is always marked `estimated:true`. Inspect it live:

```bash
mawf models                # capability view of all provider models + per-role assignments
mawf models --app codex    # same for the codex app_type
```

Each agent's `.json`/`.md` carries the full `model_selection` record (chosen provider+model, capability fit, remaining quota, price, reasons, alternates) — see [`examples/.maw-sample/agents/orchestrator.json`](./examples/.maw-sample/agents/orchestrator.json).

**Model price gate (HITL, mandatory).** Whenever MAW is about to assign a model whose unit price is high — **Input > $2/1M Tokens or Output > $10/1M Tokens** ([`src/pricegate.js`](./src/pricegate.js), single source of truth) — it **pauses the related work and reports to a human first**:

- `mawf plan` / `mawf init` / `mawf add-agent` print a ⚠ PRICE GATE report (role, provider, model, prices, thresholds) and **exit 3** instead of proceeding; the generated `.maw/` files stay on disk so you can inspect the assignments.
- `mawf guard` / `mawf acquire` **deny** any role whose expensive model is not yet approved, so paused work stays paused.
- A human resumes work in one of three ways: pick a cheaper model (edit `.maw/agents/<role>.json`, re-run `mawf plan`), explicitly approve per role (`mawf approve-model --role <role> --yes` — sticky across re-plans), or override for one run (`--allow-pricey`).

## 7. cc-switch Integration & Routing Policy
MAW treats your cc-switch as **read-only by default**. The rules below are enforced in code ([`src/ccswitch.js`](./src/ccswitch.js), `guardSql`):

- **Snapshot before every init.** `mawf init` FIRST packages **all** cc-switch config files into a timestamped archive at `~/.cc-switch/maw-backups/cc-switch-snapshot-<timestamp>.tar.gz` (falls back to a directory copy + sha256 manifest where `tar` is unavailable) — before MAW touches anything else. Only reads existing files; writes only NEW files under `maw-backups/`.
- **All existing cc-switch data is read-only.** Reads use a read-only SQLite connection (`node:sqlite` `readOnly:true`).
- **Project functionality DECOUPLED by default.** cc-switch's "project" feature (the `profiles` table) is incomplete, so MAW no longer reads/writes profiles: MAW manages project-level agent/subagent model configs itself in `.maw/agents/*.json` and syncs only **provider config info** read-only (the high-value settings in each provider's `config.toml`/`config.json` — base_url, model, auth_mode, failover queue …). The profile code modules stay in `src/ccswitch.js` (with tests) but are disabled; set `MAW_CC_PROJECT_SYNC=1` to temporarily re-enable the legacy create/reuse of a `MAW: <project> (<user>)` profile.
- **Never touch "默认" profiles.** Any profile whose name contains `默认` (e.g. `Claude Code 默认`, `Codex 默认`) is **never** written, updated, or deleted — a hard guard refuses it (this guard stays even when the legacy sync is re-enabled).
- **Routing rules** (`mawf routing` / `mawf doctor` checks; `mawf routing --fix` applies the carve-out, writing **only** `proxy_config` for claude/codex):
  - **Claude Code:** local routing **always ON** + auto-failover **always ON**.
  - **Codex:** when an **OpenAI OAuth (ChatGPT) login** is in use → local routing **OFF**; otherwise **ON**. (OAuth is detected from `codex_oauth_auth.json` + the provider's `auth.auth_mode === "chatgpt"`.)

## 8. trellis init as the Mandatory Next Step
**Always run `trellis init -u <user-name>` as the step right after `mawf init`.** MAW does this for you automatically (it invokes [`@mindfoldhq/trellis`](https://github.com/mindfoldhq/trellis) — a more powerful, more rigorous workflow framework). Use `mawf init --no-trellis` to skip.

Because trellis and MAW can both manage files, on conflict MAW **pauses** trellis init:
1. **Snapshot** MAW-managed files (`.maw/*`, excluding `runtime/`/`logs/`).
2. **Run** `trellis init -u <user> -y --claude --codex`, streaming output to `.maw/logs/trellis-init-<timestamp>.log`.
3. **Detect** any MAW-managed file trellis touched → **pause**, print the conflict details + overview + log path in the terminal.
4. **You choose** per conflict: `[m]` keep MAW (regenerate via `mawf plan`) · `[t]` keep trellis · `[r]` re-run trellis init to **resume progress**.
5. MAW applies your choice and continues.

(A black-box CLI can't be paused mid-write, so MAW detects conflicts immediately after the conflicting write, then resumes by re-running the idempotent `trellis init`.) See [`src/trellis.js`](./src/trellis.js).

**Trellis update tracker.** The repo's GitHub Actions workflow [`trellis-update-tracker`](./.github/workflows/trellis-tracker.yml) automatically tracks `@mindfoldhq/trellis` updates (weekly + manual dispatch): when a new npm version appears it opens an `[trellis-tracker]` issue with version + links and advances `.github/trellis-tracker/state.json`. The only exception: **if trellis deletes its repo** (upstream 404), the tracker opens ONE notice issue, pauses tracking, and the workflow still succeeds — it resumes automatically when the upstream comes back. MAW invokes trellis via `@latest`, so no upgrade action is required in MAW itself; the issue is a heads-up to review the changelog.

## 9. Cost Control Mechanism
Real inference spend from cc-switch's `proxy_request_logs` → USD/min. **Per-agent** $5/min, **total** $10/min (independent), **max concurrency** 16 — editable in `.maw/config.yaml` or via flags. Pricing source chain: cc-switch `model_pricing` → provider `cost_multiplier` → vendored **estimate** (tagged `estimated:true`) → `null` (never faked). Hosts not routed via the cc-switch proxy (pi, dsh) have no measured spend rate → rate limits degrade to concurrency-only; the **price gate** still applies on dsh via cc-switch's auto-synced `~/.cc-switch/model-pricing.json` (matched ids get real prices, unmatched stay unknown).

```bash
mawf cost      # current rate + top sessions + used% vs limit
mawf guard     # ALLOW/DENY a new spawn right now (pre-spawn check)
mawf acquire --id <id> --role <r>   # take a slot
mawf release --id <id>             # release a slot
```

## 10. Installation
**From npm:** `npx multi-agents-workflow@latest install`.
**From a fork/clone (now):**
```bash
git clone https://github.com/<you>/multi-agents-workflow.git
cd multi-agents-workflow
npx . install          # or node bin/mawf.js install
```
`install` copies commands/agents/hooks/skills into Claude Code (and Codex, best-effort), records **every written file** in the `~/.maw/installed.json` manifest, and is non-destructive (`uninstall` removes exactly those files across all hosts — including the non-`maw-*` plugin agents/hooks — then prunes dirs it emptied). **Install is additive across special hosts** (0.4.2): `MAW_HOST=pi install` on a dsh install ships both hosts' assets and records both dirs — install never silently drops another host's assets; explicit removal is `uninstall`. Project configs in `.maw/` are **kept** unless you pass `--purge-config`; `--restore-routing` rolls cc-switch `proxy_config` back to the pre-init snapshot. `update` re-copies templates, preserving your edits, and **removes stale assets** an older install left behind (exact v2-manifest diff — user files are never touched). `upgrade` self-upgrades **and refreshes installed templates by default**: `git fetch` + ff-only pull for checkout installs, `npm i -g` for npm installs (`--dry-run`, `--remote`; never stashes/rebases/forces) — then spawns the new `bin/mawf.js update` **with the installed host inherited** (skip with `--no-apply-templates`; a refresh failure degrades to a warning).

## 11. Usage Examples
**Minimal:** `mawf init -u alice` (snapshots cc-switch first) → `mawf plan --project .` → `mawf run` → `mawf cost`.
**Model choice:** `mawf models` — see which provider(api key)+model each role gets and why (capability fit → remaining quota → cost rate).
**Full:** `mawf plan --project . --task-type coding --risk high --parallel 6 --value high --context large` → `mawf guard` before each spawn → `mawf acquire/release` → `mawf review --after post-implementation`.
See [`examples/complex-project-workflow.md`](./examples/complex-project-workflow.md) and the generated [`examples/.maw-sample/`](./examples/.maw-sample/).

**Common errors:** `cc-switch database not found` → `mawf doctor`; `DENY spawn ... per-agent limit` → lower concurrency or raise `--per-agent`; `codex not ready` → install codex + codex-plugin-cc (MAW degrades to a second Claude reviewer for risk ≥ medium); `routing NOT compliant` → `mawf routing --fix`.

## 12. Directory Structure
```
bin/mawf.js  src/  plugin/  skills/  defaults/  examples/  tests/  docs/
.github/workflows/ci.yml  README.{md,zh-Hans,zh-Hant}  LICENSE(MIT)
```

## 13. Security Notes
cc-switch is read-only by default; the only writes are (a) the DECOUPLED project-profile sync — **disabled by default**, re-enabled only via `MAW_CC_PROJECT_SYNC=1` (creates a NEW profile only, never touches `默认`) — and (b) the opt-in `proxy_config` carve-out for claude/codex — both hard-guarded (no `DELETE`/`DROP`, no `UPDATE` on profiles/providers/skills, never on `默认`). The price gate pauses expensive model assignments until a human acts. The `PreToolUse` hook only **blocks** over-budget spawns. External code was reviewed (license + no hidden network/credential-harvesting) before reuse — see [`NOTICE.md`](./NOTICE.md), [`ACKNOWLEDGEMENTS.md`](./ACKNOWLEDGEMENTS.md).

## 14. Known Limitations
- Not yet on npm (use `npx . install`).
- The cost guard measures **past** spend; a burst can briefly exceed the limit.
- Codex review depends on codex-plugin-cc; without it, MAW substitutes a second Claude reviewer.
- The routing carve-out writes cc-switch's SQLite directly; the cc-switch GUI may need a restart to reflect it.
- Cross-process graph crash recovery is on the roadmap.

## 15. Contributors
- **imBlanker** — initial implementation.
> Contributions welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md). *(No other contributors are fabricated.)*

## 16. Contact
- Issues: <https://github.com/imBlanker/multi-agents-workflow/issues>
- Author: **imBlanker** (GitHub). *(Contact details to be added; none fabricated.)*

---

## Testing
```bash
npm test        # 69 node:test cases
node bin/mawf.js doctor
```

## GitHub Stars Trend
The badge at the top always shows the live star count (via [shields.io](https://shields.io)). The trend chart below is embedded via the official [star-history](https://www.star-history.com/blog/how-to-use-github-star-history#how-to-embed-the-chart-in-your-readme) **"Generate embed code"** flow with a sealed repo-read token (`sealed_token`) — it renders reliably regardless of star-history's shared token-pool state, is dark/light aware, and auto-updates on each view:

<a href="https://www.star-history.com/?type=date&repos=imBlanker%2Fmulti-agents-workflow">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=imBlanker/multi-agents-workflow&type=date&theme=dark&legend=top-left&sealed_token=PYzm97OB-CHuFqRbxwItWNfcNPaj1VeB_w7lokYexF6G_txF6lQ5fkUsDSa2CA-OXsxYMZMRjbrqcsM4xF_3tlnZqyQRfDYzMvEEFRDiRV2FhIbBv3Ythw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=imBlanker/multi-agents-workflow&type=date&legend=top-left&sealed_token=PYzm97OB-CHuFqRbxwItWNfcNPaj1VeB_w7lokYexF6G_txF6lQ5fkUsDSa2CA-OXsxYMZMRjbrqcsM4xF_3tlnZqyQRfDYzMvEEFRDiRV2FhIbBv3Ythw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=imBlanker/multi-agents-workflow&type=date&legend=top-left&sealed_token=PYzm97OB-CHuFqRbxwItWNfcNPaj1VeB_w7lokYexF6G_txF6lQ5fkUsDSa2CA-OXsxYMZMRjbrqcsM4xF_3tlnZqyQRfDYzMvEEFRDiRV2FhIbBv3Ythw" />
 </picture>
</a>

> The `sealed_token` is encrypted by star-history — the raw GitHub token is never exposed in this README. If the chart ever stops rendering (token revoked or expired), regenerate the embed on [star-history.com](https://www.star-history.com/) and paste the new snippet here.

---

License: **MIT** — see [`LICENSE`](./LICENSE).
