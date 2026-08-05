---
description: Plan a dynamic multi-agent workflow for the current project (probes codebase, reads cc-switch, picks architecture, writes .maw/ configs)
argument-hint: '[--task-type coding|research|refactor|review|migration|greenfield] [--risk low|medium|high] [--parallel N] [--per-agent USD] [--total USD]'
allowed-tools: Bash, Read, Glob, Grep, Write
---

Run `maw plan` for the current project, then read back `.maw/plan.md` and summarize the selected architecture, the agent roster, and any review gates to the user.

Core steps:
1. Run `node ${CLAUDE_PLUGIN_ROOT}/../bin/maw.js plan --project $PWD $ARGUMENTS` (or `maw plan --project $PWD $ARGUMENTS` if on PATH).
2. Read `.maw/plan.md`.
3. Tell the user: the primary architecture, why it was selected, the agents/roles, the cost limits, and the Codex review gates (if any).
4. Remind them they can edit any file under `.maw/agents/` and re-run `maw plan` to regenerate.

Do not start implementation in this command — planning only. Use `/maw:run` for execution guidance.
