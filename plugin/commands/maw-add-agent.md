---
description: Dynamically add an agent/role to the current workflow plan and regenerate its config files
argument-hint: '--role NAME [--model claude-sonnet-5] [--app claude|codex] [--agent claude-code|codex] [--per-agent USD] [--tools Read,Edit,Bash] [--review] [--task "..."]'
allowed-tools: Bash, Read
---

Run `node ${CLAUDE_PLUGIN_ROOT}/../bin/maw.js add-agent --project $PWD $ARGUMENTS`. The new agent is appended to `.maw/workflow.json` and gets its own `.maw/agents/<role>.md` and `.maw/agents/<role>.json`. Existing files are preserved. Confirm to the user what was added.
