# Agent: implementer-2

> Part of workflow `orchestrator-workers-sample-project` (primary: orchestrator-workers). Edit freely; the runner re-reads this file at execute time.

## Identity

- **Role**: implementer-2
- **Host agent software**: `claude-code`
- **App type (cc-switch)**: `claude`
- **Model**: `deepseek-v4-flash`
## Model selection (capability-aware)

- **Provider (api key)**: Deep Worker (`e2d33717-dbe1-4cda-8e56-cf654f6c8f6c`) — chosen from 37 available candidate(s)
- **Capability fit**: 100/100 for this role
- **Remaining quota (today)**: unknown (no daily limit set in cc-switch)
- **Provider current spend rate**: $0/min
- **Estimated**: yes (curated capability catalog + cc-switch pricing)
- **Why this provider+model**:
  - capability fit 100/100 for role "implementer" (writes and edits code end-to-end)
  - model class: agentic (multi-turn reasoning + dialogue) but text-only: no image input
  - provider remaining quota: unknown (no daily limit set in cc-switch)
  - provider current spend rate: $0/min
  - price $0.14/$0.28 per M tokens (cc-switch)
  - provider is the cc-switch current one (known-working)
- **Alternates** (next-best fits):
  - Deep Worker / `deepseek-v4-pro` (fit 100)
  - Deep Worker / `claude-haiku-4-5` (fit 100)
  - Deep Worker / `kimi-k3` (fit 100)


## Task

Implement a second independent slice in parallel.

## Tools

- `Read`
- `Edit`
- `Write`
- `Bash`

## Cost control

- **Per-agent cost-rate limit**: $5/min (USD, real inference spend measured from cc-switch logs)
- **Concurrency**: 1
- **Review required at this agent's output**: no

**Price** (exact): 0.14/M in, 0.28/M out — source: `cc-switch`

## How to invoke

Spawn this agent from the orchestrator as a subagent with the tool list above. Pass the task verbatim and require it to return a compressed summary + file diffs.
