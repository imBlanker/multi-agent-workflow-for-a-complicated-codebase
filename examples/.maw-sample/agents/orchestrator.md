# Agent: orchestrator

> Part of workflow `orchestrator-workers-sample-project` (primary: orchestrator-workers). Edit freely; the runner re-reads this file at execute time.

## Identity

- **Role**: orchestrator
- **Host agent software**: `claude-code`
- **App type (cc-switch)**: `claude`
- **Model**: `claude-opus-5`

## Task

Plan, decompose, delegate, synthesize.

## Tools

- `Task`
- `Read`
- `Edit`
- `Bash`

## Cost control

- **Per-agent cost-rate limit**: $1/min (USD, real inference spend measured from cc-switch logs)
- **Concurrency**: 1
- **Review required at this agent's output**: yes

**Price** (exact): 5/M in, 25/M out — source: `cc-switch`

## How to invoke

Spawn this agent from the orchestrator as a subagent with the tool list above. Pass the task verbatim and require it to return a compressed summary + file diffs.
