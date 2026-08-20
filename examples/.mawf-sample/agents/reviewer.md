# Agent: reviewer

> Part of workflow `orchestrator-workers-sample-project` (primary: orchestrator-workers). Edit freely; the runner re-reads this file at execute time.

## Identity

- **Role**: reviewer
- **Host agent software**: `codex`
- **App type (cc-switch)**: `codex`
- **Model**: `deepseek-v4-flash`
## Model selection (capability-aware)

- **Provider (api key)**: DeepSeek (`5c1b48a6-b5af-4d3c-b612-f9d9c39988e1`) — chosen from 9 available candidate(s)
- **Capability fit**: 100/100 for this role
- **Remaining quota (today)**: unknown (no daily limit set in cc-switch)
- **Provider current spend rate**: $0/min
- **Estimated**: yes (curated capability catalog + cc-switch pricing)
- **Why this provider+model**:
  - capability fit 100/100 for role "reviewer" (independent code/architecture/security review)
  - model class: agentic (multi-turn reasoning + dialogue) but text-only: no image input
  - provider remaining quota: unknown (no daily limit set in cc-switch)
  - provider current spend rate: $0/min
  - price $0.14/$0.28 per M tokens (cc-switch)
- **Alternates** (next-best fits):
  - DeepSeek copy / `deepseek-v4-flash` (fit 100)
  - OpenAI Official / `gpt-5.6-terra` (fit 100)
  - GGBOOM / `gpt-5.3-codex` (fit 100)


## Task

Independent code/architecture/security review via codex-plugin-cc.

## Tools

- `codex:review`
- `codex:adversarial-review`

## Cost control

- **Per-agent cost-rate limit**: $5/min (USD, real inference spend measured from cc-switch logs)
- **Concurrency**: 1
- **Review required at this agent's output**: yes

**Price** (exact): 0.14/M in, 0.28/M out — source: `cc-switch`

## How to invoke

This agent runs via **codex-plugin-cc**. From Claude Code:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/codex-companion.mjs" review --wait
```

or use the slash command `/codex:review` (review-only). For adversarial review use `/codex:adversarial-review`.
