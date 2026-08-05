# Agent: reviewer

> Part of workflow `orchestrator-workers-sample-project` (primary: orchestrator-workers). Edit freely; the runner re-reads this file at execute time.

## Identity

- **Role**: reviewer
- **Host agent software**: `codex`
- **App type (cc-switch)**: `codex`
- **Model**: `gpt-5.2-codex`

## Task

Independent code/architecture/security review via codex-plugin-cc.

## Tools

- `codex:review`
- `codex:adversarial-review`

## Cost control

- **Per-agent cost-rate limit**: $1/min (USD, real inference spend measured from cc-switch logs)
- **Concurrency**: 1
- **Review required at this agent's output**: yes

**Price** (exact): 1.75/M in, 14/M out — source: `cc-switch`

## How to invoke

This agent runs via **codex-plugin-cc**. From Claude Code:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/codex-companion.mjs" review --wait
```

or use the slash command `/codex:review` (review-only). For adversarial review use `/codex:adversarial-review`.
