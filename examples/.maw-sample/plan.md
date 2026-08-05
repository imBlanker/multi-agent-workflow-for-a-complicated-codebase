# Workflow Plan: orchestrator-workers-sample-project
Generated 2026-08-05T04:49:47.719Z on host `claude-code` (capabilities: subagents, multi-agent, dynamic-workflow, codex-review).

## Selected architecture
- **Primary**: `orchestrator-workers`
- **Combined**: `dynamic`

## Rationale
- [orchestrator-workers] 6 parallelizable subtasks / context large: delegate to subagents with own windows
- [multi-agent] high-value (high) breadth-first work, 6 parallel directions: multi-agent scales token spend
- [ultracode] complex coding with codex-review available: graph checkpoints + implement→review→fix loop

## Agents & roles
### orchestrator  (`claude-code`, model `claude-opus-5`)
- Task: Plan, decompose, delegate, synthesize.
- Cost-rate limit: $1/min; concurrency 1; review required: true
### researcher  (`claude-code`, model `claude-opus-5`)
- Task: Investigate independent facets and compress findings.
- Cost-rate limit: $1/min; concurrency 1; review required: false
### implementer  (`claude-code`, model `claude-opus-5`)
- Task: Implement a vertical slice end-to-end.
- Cost-rate limit: $1/min; concurrency 1; review required: false
### implementer-2  (`claude-code`, model `claude-opus-5`)
- Task: Implement a second independent slice in parallel.
- Cost-rate limit: $1/min; concurrency 1; review required: false
### researcher-2  (`claude-code`, model `claude-opus-5`)
- Task: Secondary breadth-first exploration.
- Cost-rate limit: $1/min; concurrency 1; review required: false
### reviewer  (`codex`, model `gpt-5.2-codex`)
- Task: Independent code/architecture/security review via codex-plugin-cc.
- Cost-rate limit: $1/min; concurrency 1; review required: true

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
- Per-agent limit: $1/min
- Total workflow limit: $10/min (independent constraint; enforced via concurrency + rate gating)
- Max concurrency: 4
- Pricing sources: cc-switch:model_pricing

## Dynamic mutation
- Add an agent: `maw add-agent --role NAME --model ID --app claude`
- Remove an agent: `maw remove-agent --role NAME`
- Re-plan: `maw plan --project .`

Edit any file under `.maw/agents/` directly; the runner reads them at execute time.
