# MAW — 面向复杂代码库的多智能体工作流系统

[![CI](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml/badge.svg)](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-52%20passing-success.svg)](#testing)

> 一套可移植、**动态**的多智能体工作流系统。面对一个新的复杂项目，MAW 会读取你的 [cc-switch](https://github.com/farion1231/cc-switch) 配置，探测代码库，并挑选合适的智能体架构 — *循环（loop）*、*编排者-工人*（子智能体）、*多智能体*、*图工作流（graph）*、*动态工作流（dynamic）* 或 *ultracode* — 或它们的组合。它为每个智能体生成可独立编辑的配置，强制执行**基于真实花费的成本速率限制**，并集成**通过 `codex-plugin-cc` 实现的 Codex 审查**。

它不会硬编码某一种架构。宿主（Claude Code、Codex 等）驱动执行；MAW 提供计划、成本关卡与审查关卡。

---

## 目录
1. [项目目标](#1-项目目标)
2. [何时使用](#2-何时使用)
3. [系统架构](#3-系统架构)
4. [支持的智能体软件](#4-支持的智能体软件)
5. [工作流选择机制](#5-工作流选择机制)
6. [智能体与子智能体配置](#6-智能体与子智能体配置)
7. [成本控制机制](#7-成本控制机制)
8. [安装](#8-安装)
9. [使用示例](#9-使用示例)
10. [目录结构](#10-目录结构)
11. [安全说明](#11-安全说明)
12. [已知限制](#12-已知限制)
13. [路线图](#13-路线图)
14. [参考项目与致谢](#14-参考项目与致谢)
15. [贡献者](#15-贡献者)
16. [联系方式](#16-联系方式)

---

## 1. 项目目标

- **动态，而非固定。** 针对每个项目，MAW 会用真实信号（文件数量、语言、可并行子任务、风险、上下文需求、价值/成本容忍度、人工介入（HITL）/持久化需求）加上宿主的原生能力，对六种架构评分，并选出最合适的 — 或它们的组合。
- **可移植。** 计划与按智能体的配置都是纯 JSON/YAML/Markdown，任何智能体软件都能读取。Claude Code 获得完整插件（命令/智能体/钩子/技能）；Codex 获得智能体；其他软件获得可移植文件。
- **成本有界。** 来自 cc-switch 日志的真实推理花费，而非 token 估算。默认值：**每智能体 $1/分钟**、**总计 $10/分钟**（相互独立）、最大并发 4 — 均可编辑。
- **Codex 审查，按风险关卡触发。** 当 `codex-plugin-cc` 可用时，Codex 会在基于风险的关卡处担任独立审查者 — 而不是每一步都审查。
- **可复用，而非照搬。** 我们研究了开源项目（见 §14）并采纳了它们的*思想*；实现是原创的。

## 2. 何时使用

- 一个**新的复杂项目**：先 `maw init -u <user>`，再 `maw plan`。
- 单个智能体不够用：文件众多、多种语言、高风险，或上下文超出一个窗口。
- 你需要**成本有界**的多智能体运行，配备 **Codex 审查关卡**并能优雅降级。
- 你想要可预测、可检视的控制（图工作流），并带有人工介入的检查点。

**不宜使用的场景：** 极小且固定的任务（单次 LLM 调用 + 检索即可），或所有智能体必须共享同一上下文、且相互依赖众多的任务（大多数简单编码任务 — 单个循环智能体更便宜）。

## 3. 系统架构

```
                 ┌─────────────────────────────────────────────┐
   user/project │  maw plan                                   │
                 │  probe → score architectures → select      │
                 │  generate per-agent configs (.maw/)        │
                 └───────────────┬─────────────────────────────┘
                                 │
        ┌────────────────────────┼──────────────────────────────┐
        ▼                        ▼                              ▼
┌──────────────┐        ┌────────────────┐            ┌──────────────────┐
│ cc-switch    │        │ host agent      │            │ codex-plugin-cc  │
│ (SQLite, RO) │        │ (Claude Code)   │            │ (Codex reviewer) │
│ providers,   │        │ drives execute  │            │ risk-gated       │
│ model_pricing│        │ via Task/delegate│           │ review gates     │
│ request_logs │        └────────┬────────┘            └──────────────────┘
└──────────────┘                 │
        ▲                        ▼
        │              ┌──────────────────────────┐
        │              │ cost guard (pre-spawn)   │
        └──────────────│ $/min per-agent + total, │
                       │ concurrency cap          │
                       └──────────────────────────┘
```

- **引擎**（`src/`）：`ccswitch.js`（通过 `node:sqlite` 只读访问数据库）、`pricing.js`（回退链）、`planner.js`（架构选择）、`graph.js`（工作流图）、`configgen.js`（按智能体生成文件）、`cost.js`（成本速率限制）、`codex.js`（审查集成）、`installer.js`、`doctor.js`、`host.js`、`probe.js`。
- **插件**（`plugin/`）：Claude Code 命令（`/maw:plan`、`/maw:run`、`/maw:cost`、`/maw:doctor`、`/maw:add-agent`、`/maw:review`）、智能体定义，以及一个 `PreToolUse` 钩子，它会在每次 `Task` 派生前调用成本护栏。
- **技能**（`skills/`）：可移植的技能文件（`maw-orchestration`、`maw-planner`、`maw-loop`、`maw-graph`、`maw-cost-guard`）。

## 4. 支持的智能体软件

| 宿主 | 状态 | 说明 |
|---|---|---|
| **Claude Code** | 完整支持 | 命令、智能体、钩子、技能；原生 `Task`/delegate 用于子智能体与多智能体。 |
| **Codex** | 尽力而为 | 智能体定义复制到 `~/.codex/agents`；通过 `codex-plugin-cc` 作为审查者调用。 |
| **Gemini CLI / opencode / 其他** | 可移植 | 直接读取 `.maw/` 下的 JSON/YAML/Markdown；尚无原生集成。 |

MAW 会自动检测宿主（`maw doctor`）。当宿主拥有**原生**的动态工作流 / 多智能体机制时，MAW 会在其上叠加 `dynamic` 并让宿主驱动 — 而不是重新实现协调逻辑。

## 5. 工作流选择机制

规划器会对每种架构评分（分越高越合适），然后选出最高分的那一种，并视情况与其他架构组合。

| 信号 | 可能的选择 |
|---|---|
| 极小、固定、低风险 | `none`（单次调用） |
| 开放式、步骤不可预测、单一上下文 | `loop` |
| 许多动态可并行子任务 / 上下文超出一个窗口 | `orchestrator-workers` |
| 高价值广度优先、并行、可容忍约 15 倍成本 | `multi-agent` |
| 需要可预测性、人工介入（HITL）、持久化、分支 | `graph` |
| 宿主拥有原生的动态工作流 / 多智能体 | `dynamic`（叠加在其上） |
| 复杂编码 + 可用 codex 审查 | `ultracode`（图工作流 + 循环 + codex 修复关卡） |

它们可以组合，并非互斥。例如 `ultracode` = `graph` + `loop` + 一个 Codex 审查关卡。完整的评分细则与理论基础（Anthropic / LangGraph / Lilian Weng）请见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 6. 智能体与子智能体配置

`maw plan` 会在 `.maw/` 下为每个智能体/角色写入一份**可独立编辑**的配置：

```
.maw/
  workflow.json          # full plan (re-read at execute time)
  config.yaml            # global knobs: cost limits, concurrency, pricing sources
  plan.md                # human-readable execution guide
  graph.json             # workflow graph (nodes/edges)
  agents/
    orchestrator.md      # portable agent definition (one per role)
    orchestrator.json    # machine config: model, appType, cost limit, tools, price
    researcher.md / .json
    implementer.md / .json
    reviewer.md / .json  # codex reviewer
  runtime/               # concurrency + cost state (gitignored)
```

没有任何东西是硬编码的：智能体/角色来自计划。可动态增删：

```bash
maw add-agent --role static-analyzer --model claude-sonnet-5 --app claude --task "Static analysis pass."
maw remove-agent --role static-analyzer
```

可直接编辑任意文件 — 运行器会在执行时重新读取它。

## 7. 成本控制机制

MAW 从 cc-switch 的 `proxy_request_logs` 中度量**真实推理花费**（一个时间窗口内的 `total_cost_usd` → USD/分钟）。这是权威的成本速率，而非 token 估算。

- **按智能体**：默认 $1/分钟（超出该值的会话会阻止新的派生）。
- **整个工作流**：默认 $10/分钟（与按智能体的合计相互独立）。
- **最大并发**：默认 4。
- 均可在 `.maw/config.yaml` 中或通过参数（`--per-agent`、`--total`、`--concurrency`）编辑。

**定价来源链**（用于在配置中*标注*模型价格）：
1. cc-switch `model_pricing`（精确）→ 2. cc-switch 提供商 `cost_multiplier`（在其上叠加）→ 3. 内置回退**估算**（标记为 `estimated: true`）→ 4. `null`（绝不伪装为精确值）。

当价格为估算值时，配置以及 `maw cost`/`doctor` 会明确说明。

```bash
maw cost     # current rate + top sessions + used% vs limit
maw guard    # ALLOW/DENY a new spawn right now (pre-spawn check)
maw acquire --id <id> --role <r>   # take a slot (refuses if over budget)
maw release --id <id>             # release a slot
```

## 8. 安装

**通过 npm（已发布）：**
```bash
npx multi-agent-workflow install
```

**从克隆仓库（用于开发 / 发布前）：**
```bash
git clone https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase.git
cd multi-agent-workflow-for-a-complicated-codebase
npx . install          # or: node bin/maw.js install
```

`install` 会把插件（命令/智能体/钩子/技能）复制进宿主智能体软件的目录，向 `~/.maw/installed.json` 写入安装清单，并运行环境检查。它是非破坏性的：`update` 只覆盖 MAW 自己的模板文件，保留你添加的任何其他内容。

| 操作 | 命令 |
|---|---|
| 安装 | `npx multi-agent-workflow install` |
| 更新 | `npx multi-agent-workflow update` |
| 卸载 | `npx multi-agent-workflow uninstall` |
| 初始化项目 | `maw init -u <your-name>` |
| Doctor（环境检查） | `maw doctor` |

## 9. 使用示例

**最小用例 — 规划并运行一个小项目：**
```bash
maw init -u alice
maw plan --project .
maw run            # batched execution guidance
maw cost           # real cost rate
```

**完整工作流 — 一个复杂、高风险的代码库：**
```bash
# 1. plan with explicit signals (or let MAW probe)
maw plan --project . --task-type coding --risk high --parallel 6 --value high --context large

# 2. before spawning each agent, the host checks the guard
maw guard --project .

# 3. acquire/release slots around each subagent run
maw acquire --id impl-1 --role implementer
#   ... run implementer subagent ...
maw release --id impl-1

# 4. at review gates, invoke Codex (risk-gated)
maw review --after "post-implementation"
```

端到端的完整演练请见 [`examples/complex-project-workflow.md`](./examples/complex-project-workflow.md)，一份真实生成的计划（6 个智能体：编排者 + 2 个研究员 + 2 个实现者 + codex 审查者）请见 [`examples/.maw-sample/`](./examples/.maw-sample/)。

**常见错误：**
- `cc-switch database not found` → 运行 `maw doctor`；确保 `~/.cc-switch/cc-switch.db` 存在，或设置 `CC_SWITCH_DB`。
- `DENY spawn: ... per-agent limit` → 某个会话超过了 $1/分钟；降低并发或提高 `--per-agent`。
- `codex not ready` → 安装 `codex` 和 `codex-plugin-cc`；之后 MAW 会降级为第二个 Claude Code 审查者来处理风险 ≥ 中等的情况。
- `no workflow.json; run maw plan first` → 运行 `maw plan --project .`。

## 10. 目录结构

```
.
├── bin/maw.js              # CLI entry
├── src/                    # engine (ccswitch, pricing, planner, graph, cost, codex, …)
├── plugin/                 # Claude Code plugin (commands, agents, hooks, skills)
├── skills/                 # portable skills
├── defaults/               # pricing.fallback.json (estimates, clearly marked)
├── examples/               # sample project + a real generated .maw plan
├── tests/                  # node:test suite (52 tests) + fixture db builder
├── docs/ARCHITECTURE.md    # architecture + theoretical grounding
├── .github/workflows/ci.yml
├── README.md / README.zh-Hans.md / README.zh-Hant.md
└── LICENSE  (MIT)
```

## 11. 安全说明

- MAW 以**只读**方式读取 cc-switch（`node:sqlite` 处于 `readOnly: true` 模式；绝不修改提供商数据）。
- 它绝不把密钥写入日志。`doctor`/`cost` 会对认证令牌进行脱敏。
- Codex 审查路径会调用 `codex-plugin-cc` 的配套脚本；MAW 不内嵌任何凭据。
- `PreToolUse` 钩子只**阻止**超出成本/并发预算的派生 — 它不会修改工具输入。
- 在复用任何外部代码前，我们都已检查：许可证允许复用、无明显的安全风险、没有隐藏的网络调用 / 凭据采集 / 危险的自动执行。详见 [`NOTICE.md`](./NOTICE.md)。

## 12. 已知限制

- 成本护栏度量的是**过去**的花费；突发流量可能在下一次日志刷新前短暂超出限制。
- Codex 审查集成依赖 `codex-plugin-cc` 已安装；缺少它时，MAW 会替换为第二个 Claude Code 审查者（优雅降级，但不是 Codex）。
- 按智能体的速率限制按**会话**执行；共享同一会话 id 的智能体共享一个预算。
- 图持久化可在同一会话内恢复状态；跨进程的崩溃恢复已在路线图中。
- 尚未发布到 npm；在发布前请从克隆仓库使用 `npx . install`。

## 13. 路线图

- [ ] 以 `multi-agent-workflow` 为名发布到 npm。
- [ ] 图状态的跨进程崩溃恢复。
- [ ] 运行器中 LangGraph 风格的条件边求值。
- [ ] 在基于花费的成本速率之外，增加按智能体的 token 预算预估。
- [ ] Gemini CLI / opencode 的原生集成。
- [ ] 用于实时成本 + 并发监控的 Web UI。

## 14. 参考项目与致谢

我们研究了这些开源项目并采纳了它们的**思想**（工作流调度、智能体/角色管理、动态工作流生成、图执行、循环控制、成本预算、插件安装、多智能体消息传递）。MAW 的实现是原创的；没有整体照搬任何项目。借鉴了什么以及为什么，详见 [`NOTICE.md`](./NOTICE.md)。

- **Anthropic — *Building Effective Agents*** 与 ***How we built our multi-agent research system*** — 工作流与智能体的区分、编排者-工人模式、子智能体上下文压缩、约 15 倍 token 成本意识，以及基于风险的评估。
- **LangChain / LangGraph** — 图即节点与边、声明式结构 + 动态路径、持久化/人工介入（HITL）、"难点在于每一步的上下文"。
- **Lilian Weng — *LLM Powered Autonomous Agents*** — ReAct/Reflexion 循环与反思机制。
- [`mbruhler/claude-orchestration`](https://github.com/mbruhler/claude-orchestration)（MIT）— 多智能体编排插件布局。
- [`garyqlin/glink-engine`](https://github.com/garyqlin/glink-engine)（MIT）— 零依赖的 YAML 图引擎 + 共享事件总线。
- [`milanglacier/pi-dynamic-workflow`](https://github.com/milanglacier/pi-dynamic-workflow)（MIT）— 动态工作流选择。
- [`srijansk/agent-relay`](https://github.com/srijansk/agent-relay)（MIT）— YAML 工作流 + 智能体中继。
- [`x-glacier/SwarmFlow`](https://github.com/x-glacier/SwarmFlow)（Apache-2.0）— 多智能体编排 + 成本意识。
- [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) — Codex 审查集成的目标。
- **star-history**（开源）— GitHub 星标趋势图（见下文）。

## 15. 贡献者

- **imBlanker** — 初始实现。

> 欢迎贡献。详见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。*（本节为占位内容；未编造其他贡献者。）*

## 16. 联系方式

- Issues: <https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues>
- 作者：**imBlanker**（GitHub）— *联系方式待补充。*

*（联系方式刻意留为占位；未编造任何个人邮箱或账号。）*

---

## Testing

```bash
npm test        # 52 node:test cases (engine + CLI + installer + codex)
npm run smoke   # maw doctor + maw plan --self-test against this repo
npm run demo    # generate examples/.maw-sample
```

## GitHub 星标趋势

本图表会自动读取仓库的星标数并自我更新 — 无需自建的统计服务。它由开源项目 **[star-history](https://github.com/star-history/star-history)** 生成。

[![Star History](https://api.star-history.com/svg?repos=imBlanker/multi-agent-workflow-for-a-complicated-codebase&type=Date)](https://star-history.com/#imBlanker/multi-agent-workflow-for-a-complicated-codebase&Date)

---

许可证：**MIT** — 详见 [`LICENSE`](./LICENSE)。
