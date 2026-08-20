# Agent: orchestrator

> Part of workflow `orchestrator-workers-sample-project` (primary: orchestrator-workers). Edit freely; the runner re-reads this file at execute time.

## Identity

- **Role**: orchestrator
- **Host agent software**: `claude-code`
- **App type (cc-switch)**: `claude`
- **Model**: `claude-haiku-4-5`
## Model selection (capability-aware)

- **Provider (api key)**: Deep Worker (`e2d33717-dbe1-4cda-8e56-cf654f6c8f6c`) — chosen from 37 available candidate(s)
- **Capability fit**: 100/100 for this role
- **Remaining quota (today)**: unknown (no daily limit set in cc-switch)
- **Provider current spend rate**: $0/min
- **Estimated**: yes (curated capability catalog + cc-switch pricing)
- **Why this provider+model**:
  - capability fit 100/100 for role "orchestrator" (plans, decomposes, delegates and synthesizes; vision helps read diagrams/screenshots)
  - model class: agentic AND multimodal (supports image input)
  - provider remaining quota: unknown (no daily limit set in cc-switch)
  - provider current spend rate: $0/min
  - price: unknown (not in cc-switch model_pricing)
  - provider is the cc-switch current one (known-working)
- **Alternates** (next-best fits):
  - Deep Worker / `claude-opus-5` (fit 100)
  - Any Router / `claude-opus-4-8[1M]` (fit 100)
  - Any Router / `claude-sonnet-4-5-20250929[1M]` (fit 100)


## Task

Plan, decompose, delegate, synthesize.

## Tools

- `Task`
- `Read`
- `Edit`
- `Bash`

## Cost control

- **Per-agent cost-rate limit**: $5/min (USD, real inference spend measured from cc-switch logs)
- **Concurrency**: 1
- **Review required at this agent's output**: yes

**Price** (estimated): 1/M in, 5/M out — source: `fallback:estimate`
  - Price not found in cc-switch; using vendored estimate. Verify on Artificial Analysis / OpenRouter.

## How to invoke

Spawn this agent from the orchestrator as a subagent with the tool list above. Pass the task verbatim and require it to return a compressed summary + file diffs.
