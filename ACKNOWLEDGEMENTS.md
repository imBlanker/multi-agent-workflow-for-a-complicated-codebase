# Acknowledgements

MAW — Multi-Agent Workflow for Complex Codebases — is original, MIT-licensed
code, but it would not exist in its current shape without the public thinking
and open-source work that came before it. We are grateful to the people and
teams behind the following projects and writings. What we took from each was
*ideas and architectural structure*, not source code; the detailed, per-source
record is in [`NOTICE.md`](./NOTICE.md).

## The Anthropic engineering team

The single biggest conceptual debt is to Anthropic's engineering writing. The
post [**Building effective agents**](https://www.anthropic.com/engineering/building-effective-agents)
gave MAW its core vocabulary — the distinction between *workflows* and
*agents*, the orchestrator-workers pattern, and the warning that successful
systems lean on simple, composable patterns rather than heavy frameworks. The
post [**How we built our multi-agent research system**](https://www.anthropic.com/engineering/multi-agent-research-system)
then grounded that theory in production reality: the ~15× token cost of
breadth-first multi-agent search, the engineering of subagent context
compression, and the value of independent, risk-gated evaluation. MAW's planner
taxonomy and its cost/review gates are direct descendants of these two pieces.
Thank you to the Anthropic engineering team for publishing that depth of
detail.

## The LangChain / LangGraph team

LangGraph's model of a workflow as **nodes and edges** — declarative structure
that still admits dynamic, conditional paths, with first-class persistence and
human-in-the-loop checkpoints — is the mental model behind MAW's `graph`
architecture and its `graph.json` / HITL gates. We are grateful to the
LangChain and LangGraph community for showing that "predictable graph +
human checkpoints" is a viable shape for high-risk, inspectable runs, and for
the hard-won observation that the hard part of agentic systems is context at
each step.

- [LangChain](https://github.com/langchain-ai/langchain) (MIT)
- [LangGraph](https://github.com/langchain-ai/langgraph) (MIT)

## Lilian Weng

Lilian Weng's survey [**LLM Powered Autonomous Agents**](https://lilianweng.github.io/posts/2023-06-23-agent/)
on Lil'Log is the reference that tied together the ReAct and Reflexion patterns
MAW relies on: MAW's `loop` architecture is a ReAct-style reason-act-observe
loop, and the Codex review gate's review → fix → re-review cycle is a
Reflexion pattern. Thank you for the clear, canonical synthesis that MAW's own
architecture documentation builds upon.

## OpenAI

MAW treats [**`codex-plugin-cc`**](https://github.com/openai/codex-plugin-cc)
(Apache-2.0) as its Codex review integration target: at risk-based gates, MAW
shells out to its companion script so that Codex acts as an *independent*
reviewer — a different model and session than the implementer — rather than
MAW re-implementing the Codex CLI glue. We do not redistribute it; we simply
call it. Thank you to the OpenAI team for providing that bridge.

## The authors of the referenced GitHub projects

MAW's design was sharpened by studying several smaller open-source projects.
We adopted their *ideas* only; no source code was copied. Thank you to their
authors:

- [**mbruhler/claude-orchestration**](https://github.com/mbruhler/claude-orchestration) (MIT) — the multi-agent orchestration **plugin layout** that informed the structure of MAW's own Claude Code plugin (`plugin/`).
- [**garyqlin/glink-engine**](https://github.com/garyqlin/glink-engine) (MIT) — the zero-dependency YAML graph engine and shared event-bus pattern that shaped MAW's `src/graph.js` and declarative plan files.
- [**milanglacier/pi-dynamic-workflow**](https://github.com/milanglacier/pi-dynamic-workflow) (MIT) — the **dynamic workflow selection** approach that validated MAW's score-and-select planner.
- [**srijansk/agent-relay**](https://github.com/srijansk/agent-relay) (MIT) — the YAML workflow description and agent handoff (relay) pattern that informed MAW's orchestrator→subagent handoffs.
- [**x-glacier/SwarmFlow**](https://github.com/x-glacier/SwarmFlow) (Apache-2.0) — the **cost awareness** framing that underpins MAW's real-USD/min cost guard.
- [**star-history/star-history**](https://github.com/star-history/star-history) (MIT) — the GitHub Stars trend chart embedded in the README.

---

If we have overlooked a source or miscredited something, please open an issue
at <https://github.com/imBlanker/multi-agents-workflow/issues>
and we will correct it.
