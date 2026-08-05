# MAW — Agent Install & Configure Guide

> Read this end to end. Do not summarize it. This is the machine-facing guide an
> agent follows to install, configure, and use MAW on behalf of a human user.
> Human-facing overview: [`README.md`](../README.md).

## 0. Identity & scope
- MAW = `multi-agent-workflow`, CLI `maw`, MIT, zero runtime deps (Node ≥ 20.17).
- **Supported hosts: Claude Code and Codex ONLY.** If the user runs Gemini CLI / opencode / others, tell them MAW does not support their host.
- Repo: <https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase>

## 1. Fork-first (ask the user)
Recommend the user **fork** the repo first and clone their fork. Make personal changes in their fork; send insights/bugs as issues to upstream. If the user just wants to try it, you may clone upstream directly, but still flag the fork recommendation. Fork: <https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/fork>.

## 2. Install
```bash
git clone https://github.com/<user-or-you>/multi-agent-workflow-for-a-complicated-codebase.git
cd multi-agent-workflow-for-a-complicated-codebase
npx . install          # or: node bin/maw.js install
```
- Copies commands/agents/hooks/skills into Claude Code (and Codex agents, best-effort).
- Non-destructive: `uninstall` removes only `maw-*` files.
- If `npx .` is unavailable, run `node bin/maw.js install`.

## 3. Doctor (environment + policy check)
```bash
node bin/maw.js doctor
```
Verify: Node ≥ 20, git, **host = claude-code or codex**, cc-switch DB found (read-only), model pricing loaded, **routing policy compliant**, codex+codex-plugin-cc available, trellis detectable. Warnings are non-fatal; fix what you can.

## 4. cc-switch policy (HARD RULES — do not violate)
- All existing cc-switch data is **read-only**.
- `maw init` creates a **NEW** cc-switch project profile (`MAW: <project> (<user>)`); providers/MCP/Skills/memory are provisioned **only within that new project**.
- **NEVER** touch any profile whose name contains `默认` (e.g. `Claude Code 默认`, `Codex 默认`). The engine hard-refuses this; you must not bypass it.
- Routing (checked by `maw doctor` / `maw routing`; applied by `maw routing --fix`, writing ONLY `proxy_config` for claude/codex):
  - **Claude Code:** local routing **always ON** + auto-failover **always ON**.
  - **Codex:** OpenAI-OAuth (ChatGPT) login in use → local routing **OFF**; otherwise **ON**.

If `maw routing` reports violations, run `maw routing --fix` (after the user consents — it writes to their cc-switch). For Claude Code, routing+failover should be ON; if off, fix it.

## 5. Initialize the project (chains trellis)
```bash
maw init -u <user-name>
```
This: (a) writes `.maw/` configs, (b) creates the cc-switch project profile, (c) checks the routing policy, (d) **automatically runs `trellis init -u <user-name>`** as the mandatory next step.

**trellis conflict handling** (see README §8): if trellis touches a MAW-managed file, MAW pauses, prints the conflict + overview + log path (`.maw/logs/trellis-init-*.log`), and asks the user to choose `[m]` keep MAW / `[t]` keep trellis / `[r]` re-run trellis. Apply the user's choice and resume. In a non-interactive context, surface the conflicts + log and let the user decide.

Use `maw init -u <user> --no-trellis` only when you must skip the trellis chain (e.g. CI/automated).

## 6. Plan
```bash
maw plan --project .
# with explicit signals:
maw plan --project . --task-type coding --risk high --parallel 6 --value high --context large
```
Reads `.maw/workflow.json` + `plan.md` + `agents/*.json`. Report the chosen **primary architecture**, the **agents** (role→model), **cost limits**, and **review gates** back to the user.

## 7. Run (host-driven)
```bash
maw run
```
The host (Claude Code) reads the batches, and **before each spawn** checks `maw guard`, then `maw acquire --id <id> --role <role>` / `maw release --id <id>` around each subagent run. At review gates, `maw review --after post-implementation` (invokes Codex via codex-plugin-cc; risk-gated).

## 8. Cost
```bash
maw cost        # real USD/min from cc-switch logs
maw guard       # ALLOW/DENY a new spawn
```
Defaults: $1/min per agent, $10/min total, max concurrency 4. Edit `.maw/config.yaml` to change.

## 9. Graceful degradation
- No codex/codex-plugin-cc → MAW uses a **second Claude Code agent** as reviewer for risk ≥ medium.
- No cc-switch DB → pricing unavailable, cost guard uses concurrency-only limiting.
- trellis not installed → MAW prints the exact command to install/run it.

## 10. Uninstall / update
```bash
npx . uninstall     # removes maw-* files only
npx . update        # re-copies templates, keeps user edits
```

## 11. Report back to the user
After install+plan, tell the user: the architecture chosen, the agents, the cost limits, the routing compliance, and whether the trellis chain succeeded (or what conflict needs resolving). Link the log: `.maw/logs/trellis-init-*.log`.
