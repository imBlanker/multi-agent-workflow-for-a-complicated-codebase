# MAW Graph Workflow (skill)

> Use when you need predictable, inspectable control: HITL approval, persistence/checkpoints, branching, or high-risk work.

MAW models the workflow as nodes + edges (fixed or conditional). Structure is declarative; the path through it can be fully dynamic via conditional edges; `loop` nodes may self-reference.

## What the graph gives you
- **Topological batches**: groups of nodes that can run in parallel, with review/gate nodes forcing batch boundaries.
- **Validation**: every edge endpoint exists; no unexpected cycles (only `loop` nodes may self-reference); every node reachable.
- **Persistence**: `.maw/runtime/` holds concurrency + cost state so runs can resume.
- **Human-in-the-loop**: review gates interrupt execution for approval before the next batch.

## Inspect the graph
```bash
maw graph --project .    # nodes/edges + batch count
```
Read `.maw/graph.json` for the full structure. Edit `.maw/workflow.json` to add nodes/edges and re-run `maw plan`.

## Predictability vs agency
As a system becomes more agentic it becomes less predictable. MAW lets you sit anywhere on this curve: the planner picks `graph` when predictability/HITL/persistence matter; `dynamic`/`multi-agent` when flexibility matters. You can layer them.
