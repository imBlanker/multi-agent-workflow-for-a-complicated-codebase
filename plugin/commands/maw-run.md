---
description: Emit execution guidance for the current .maw/ workflow plan (topological batches, cost-guard checks, codex review points)
argument-hint: ''
allowed-tools: Bash, Read
---

1. Run `node ${CLAUDE_PLUGIN_ROOT}/../bin/maw.js run --project $PWD` and show the batched execution plan.
2. For each batch:
   a. Run `maw guard --project $PWD`. If DENY, stop and report why (cost-rate limit or concurrency cap reached) — do NOT spawn agents.
   b. If ALLOW, spawn the batch's agents as subagents (Claude Code Task tool). Pass each agent the verbatim task from its `.maw/agents/<role>.md`.
   c. For each spawned agent, call `maw acquire --id <id> --role <role> --app claude` before it starts and `maw release --id <id>` when it returns.
3. At each review gate listed in the plan, run `/maw:review --after <label>` to invoke Codex (via codex-plugin-cc) if available; otherwise fall back to a second Claude Code agent reviewer.
4. Synthesize results from the `synthesize` batch and present to the user.

Key rules:
- Never bypass the cost guard. The total cost-rate limit ($10/min by default) and per-agent limit ($1/min by default) are hard constraints measured from real cc-switch spend.
- If a required agent/model is unavailable, degrade gracefully: replace the codex reviewer with a second claude reviewer (the planner already does this), and skip unreachable subagents rather than failing the whole workflow.
