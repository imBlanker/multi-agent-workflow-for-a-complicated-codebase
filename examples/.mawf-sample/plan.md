# Workflow Plan: orchestrator-workers-sample-project
Generated 2026-08-05T09:45:18.069Z on host `claude-code` (capabilities: subagents, multi-agent, dynamic-workflow, codex-review).

## Selected architecture
- **Primary**: `orchestrator-workers`
- **Combined**: `dynamic`

## Rationale
- [orchestrator-workers] 5 parallelizable subtasks / context medium: delegate to subagents with own windows
- [ultracode] complex coding with codex-review available: graph checkpoints + implement→review→fix loop
- [multi-agent] high-value (medium) breadth-first work, 5 parallel directions: multi-agent scales token spend

## Agents & roles
### orchestrator  (`claude-code`, model `claude-haiku-4-5`)
- Task: Plan, decompose, delegate, synthesize.
- Cost-rate limit: $5/min; concurrency 1; review required: true
### researcher  (`claude-code`, model `claude-haiku-4-5`)
- Task: Investigate independent facets and compress findings.
- Cost-rate limit: $5/min; concurrency 1; review required: false
### implementer  (`claude-code`, model `deepseek-v4-flash`)
- Task: Implement a vertical slice end-to-end.
- Cost-rate limit: $5/min; concurrency 1; review required: false
### implementer-2  (`claude-code`, model `deepseek-v4-flash`)
- Task: Implement a second independent slice in parallel.
- Cost-rate limit: $5/min; concurrency 1; review required: false
### researcher-2  (`claude-code`, model `claude-haiku-4-5`)
- Task: Secondary breadth-first exploration.
- Cost-rate limit: $5/min; concurrency 1; review required: false
### reviewer  (`codex`, model `deepseek-v4-flash`)
- Task: Independent code/architecture/security review via codex-plugin-cc.
- Cost-rate limit: $5/min; concurrency 1; review required: true

## Model assignments (capability-aware)
Models differ WITHIN a leaderboard (some agentic models are full-multimodal, some are reasoning/dialogue-only, some multimodal models are not agentic), so each role first filters the available provider models by capability fit, then ranks by provider remaining quota/balance and cost rate. Capability data is curated and marked estimated.

| Role | Provider (api key) | Model | Capability fit | Remaining quota today | Price per M (in/out) |
|---|---|---|---|---|---|
| orchestrator | Deep Worker | `claude-haiku-4-5` | 100/100 | unknown | unknown |
| researcher | Deep Worker | `claude-haiku-4-5` | 100/100 | unknown | unknown |
| implementer | Deep Worker | `deepseek-v4-flash` | 100/100 | unknown | $0.14/$0.28 |
| implementer-2 | Deep Worker | `deepseek-v4-flash` | 100/100 | unknown | $0.14/$0.28 |
| researcher-2 | Deep Worker | `claude-haiku-4-5` | 100/100 | unknown | unknown |
| reviewer | DeepSeek | `deepseek-v4-flash` | 100/100 | unknown | $0.14/$0.28 |

## Execution order
### plan (serial)
- `orchestrator`: Decompose the task; write .maw/plan.md.
### execute-parallel (parallel)
- `researcher`: Explore landscape; return compressed findings.
- `implementer`: Implement vertical slice A.
- `implementer-2`: Implement vertical slice B in parallel.
- `researcher-2`: Secondary parallel exploration.
### synthesize (serial)
- `orchestrator`: Merge subagent results; resolve conflicts.

## Review gates
- post-implementation review — by codex, scope auto
- architecture/security review — by codex, scope working-tree

## Loops
- (none)

## Cost control
- Per-agent limit: $5/min (real inference spend from cc-switch proxy_request_logs)
- Total workflow limit: $10/min (independent constraint; enforced via concurrency + rate gating)
- Max concurrency: 16
- Pricing sources: cc-switch:model_pricing

## Dynamic mutation
- Add an agent: `maw add-agent --role NAME --model ID --app claude`
- Remove an agent: `maw remove-agent --role NAME`
- Re-plan: `maw plan --project .`

Edit any file under `.maw/agents/` directly; the runner reads them at execute time.
