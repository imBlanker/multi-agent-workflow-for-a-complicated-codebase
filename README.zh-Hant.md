# MAW — 面向複雜程式碼庫的多智慧體工作流系統

[![CI](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml/badge.svg)](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-52%20passing-success.svg)](#testing)

> 一套可移植的、**動態**的多智慧體工作流系統。面對一個新的複雜專案時，MAW 會讀取你的 [cc-switch](https://github.com/farion1231/cc-switch) 設定、探測程式碼庫，並挑選合適的智慧體架構 — *迴圈工程*、*編排者-工人*（子智慧體）、*多智慧體*、*圖工作流*、*動態工作流* 或 *ultracode* — 或上述架構的組合。它會為每個智慧體生成可獨立編輯的設定，強制執行**真實花費的成本速率限制**，並整合**透過 `codex-plugin-cc` 的 Codex 審查**。

它不寫死單一架構。宿主（Claude Code、Codex…）驅動執行；MAW 提供計畫、成本護欄與審查關卡。

---

## 目錄
1. [專案目標](#1-專案目標)
2. [何時使用](#2-何時使用)
3. [系統架構](#3-系統架構)
4. [支援的智慧體軟體](#4-支援的智慧體軟體)
5. [工作流選擇機制](#5-工作流選擇機制)
6. [智慧體與子智慧體設定](#6-智慧體與子智慧體設定)
7. [成本控制機制](#7-成本控制機制)
8. [安裝](#8-安裝)
9. [使用範例](#9-使用範例)
10. [目錄結構](#10-目錄結構)
11. [安全性說明](#11-安全性說明)
12. [已知限制](#12-已知限制)
13. [路線圖](#13-路線圖)
14. [參考專案與致謝](#14-參考專案與致謝)
15. [貢獻者](#15-貢獻者)
16. [聯絡方式](#16-聯絡方式)

---

## 1. 專案目標

- **動態，而非固定。** 針對每個專案，MAW 會根據真實訊號（檔案數量、語言、可並行的子任務、風險、上下文需求、價值/成本容忍度、人工介入(HITL)/持久化需求）加上宿主的原生能力，對六種架構評分，並選出最合適者 — 或一種組合。
- **可移植。** 計畫與每智慧體設定都是純 JSON/YAML/Markdown，任何智慧體軟體都能讀取。Claude Code 獲得完整外掛（指令/智慧體/鉤子/技能）；Codex 獲得智慧體；其他宿主則獲得可移植檔案。
- **成本受限。** 來自 cc-switch 日誌的真實推論花費，而非權杖估計。預設：每個智慧體 $1/分鐘、總計 $10/分鐘（獨立）、最大並發 4 — 皆可編輯。
- **Codex 審查，基於風險把關。** 當 `codex-plugin-cc` 可用時，Codex 會在基於風險的審查關卡擔任獨立審查者 — 而非每一步都審查。
- **可重用，而非抄襲。** 我們研究了開源專案（見 §14）並採納了它們的*想法*；實作則是原創的。

## 2. 何時使用

- 一個**新的複雜專案**：`maw init -u <user>` 接著 `maw plan`。
- 單一智慧體不敷使用：檔案眾多、多種語言、高風險，或上下文超過單一視窗。
- 你需要**成本受限**的多智慧體執行，搭配 **Codex 審查關卡**與優雅降級。
- 你想要可預測、可檢視的控制（圖工作流）與人工介入(HITL)檢查點。

**何時不該使用：** 極小的固定任務（單次 LLM 呼叫 + 檢索即可），或所有智慧體必須共用同一上下文且彼此相依性眾多的任務（大多數簡單的程式設計任務 — 單個迴圈工程智慧體更便宜）。

## 3. 系統架構

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

- **引擎**（`src/`）：`ccswitch.js`（透過 `node:sqlite` 的唯讀資料庫存取）、`pricing.js`（備援鏈）、`planner.js`（架構選擇）、`graph.js`（工作流圖）、`configgen.js`（每智慧體檔案）、`cost.js`（速率限制）、`codex.js`（審查整合）、`installer.js`、`doctor.js`、`host.js`、`probe.js`。
- **外掛**（`plugin/`）：Claude Code 指令（`/maw:plan`、`/maw:run`、`/maw:cost`、`/maw:doctor`、`/maw:add-agent`、`/maw:review`）、智慧體定義，以及一個 `PreToolUse` 鉤子，會在每次 `Task` 生成前呼叫成本護欄。
- **技能**（`skills/`）：可移植的技能檔案（`maw-orchestration`、`maw-planner`、`maw-loop`、`maw-graph`、`maw-cost-guard`）。

## 4. 支援的智慧體軟體

| 宿主 | 狀態 | 說明 |
|---|---|---|
| **Claude Code** | 完整 | 指令、智慧體、鉤子、技能；原生的 `Task`/delegate 支援子智慧體與多智慧體。 |
| **Codex** | 盡力而為 | 智慧體定義複製到 `~/.codex/agents`；透過 `codex-plugin-cc` 作為審查者呼叫。 |
| **Gemini CLI / opencode / 其他** | 可移植 | 直接讀取 `.maw/` 的 JSON/YAML/Markdown；尚無原生黏合層。 |

MAW 會自動偵測宿主（`maw doctor`）。當宿主具備原生的動態工作流 / 多智慧體機制時，MAW 會在上面疊加 `動態工作流`，並讓宿主驅動 — 而非重新實作協調邏輯。

## 5. 工作流選擇機制

規劃器會對每個架構評分（分數越高 = 越合適），接著挑選分數最高者，並視情況與其他架構組合。

| 訊號 | 可能選擇 |
|---|---|
| 極小、固定、低風險 | `無`（單次呼叫） |
| 開放式、步驟不可預測、單一上下文 | `迴圈工程` |
| 許多動態可並行的子任務 / 上下文超過單一視窗 | `編排者-工人` |
| 高價值的廣度優先、並行、可容忍約 15 倍成本 | `多智慧體` |
| 需要可預測性、人工介入(HITL)、持久化、分支 | `圖工作流` |
| 宿主具備原生動態工作流 / 多智慧體 | `動態工作流`（疊加在上） |
| 複雜程式設計 + codex 審查可用 | `ultracode`（圖工作流 + 迴圈工程 + codex 修正關卡） |

這些架構會組合運用，彼此並非互斥。例如 `ultracode` = `圖工作流` + `迴圈工程` + 一個 Codex 審查關卡。完整的評分標準與理論基礎（Anthropic / LangGraph / Lilian Weng）請見 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 6. 智慧體與子智慧體設定

`maw plan` 會在 `.maw/` 下為每個智慧體/角色寫入一份**可獨立編輯**的設定：

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

沒有任何東西是寫死的：智慧體/角色來自計畫。可動態新增/移除：

```bash
maw add-agent --role static-analyzer --model claude-sonnet-5 --app claude --task "Static analysis pass."
maw remove-agent --role static-analyzer
```

直接編輯任何檔案 — 執行器會在執行時重新讀取。

## 7. 成本控制機制

MAW 從 cc-switch 的 `proxy_request_logs` 衡量**真實推論花費**（一段時間視窗內的 `total_cost_usd` → USD/分鐘）。這是權威的速率，而非權杖估計。

- **每個智慧體**：預設 $1/分鐘（超過它的工作階段會封鎖新生成）。
- **整體工作流**：預設 $10/分鐘（獨立於每智慧體總和）。
- **最大並發**：預設 4。
- 皆可在 `.maw/config.yaml` 或透過旗標（`--per-agent`、`--total`、`--concurrency`）編輯。

**定價來源鏈**（用來在設定中*標記*模型價格）：
1. cc-switch `model_pricing`（精確） → 2. cc-switch 供應商 `cost_multiplier`（疊加其上） → 3. 內建備援**估計**（標記 `estimated: true`） → 4. `null`（絕不偽裝為精確）。

當價格為估計值時，設定檔與 `maw cost`/`doctor` 會明確標示。

```bash
maw cost     # current rate + top sessions + used% vs limit
maw guard    # ALLOW/DENY a new spawn right now (pre-spawn check)
maw acquire --id <id> --role <r>   # take a slot (refuses if over budget)
maw release --id <id>             # release a slot
```

## 8. 安裝

**來自 npm（已發布）：**
```bash
npx multi-agent-workflow install
```

**從克隆（用於開發 / 發布前）：**
```bash
git clone https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase.git
cd multi-agent-workflow-for-a-complicated-codebase
npx . install          # or: node bin/maw.js install
```

`install` 會將外掛（指令/智慧體/鉤子/技能）複製到宿主智慧體軟體的目錄中、將安裝清單寫入 `~/.maw/installed.json`，並執行環境檢查。它是非破壞性的：`update` 僅覆寫 MAW 自身的範本檔案，並保留你新增的其他任何內容。

| 動作 | 指令 |
|---|---|
| 安裝 | `npx multi-agent-workflow install` |
| 更新 | `npx multi-agent-workflow update` |
| 解除安裝 | `npx multi-agent-workflow uninstall` |
| 初始化專案 | `maw init -u <your-name>` |
| Doctor（環境檢查） | `maw doctor` |

## 9. 使用範例

**最小範例 — 規劃並執行一個小專案：**
```bash
maw init -u alice
maw plan --project .
maw run            # batched execution guidance
maw cost           # real cost rate
```

**完整工作流 — 一個複雜、高風險的程式碼庫：**
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

端到端流程示範請見 [`examples/complex-project-workflow.md`](./examples/complex-project-workflow.md)，真實生成的計畫請見 [`examples/.maw-sample/`](./examples/.maw-sample/)（6 個智慧體：編排者 + 2 個研究員 + 2 個實作者 + Codex 審查者）。

**常見錯誤：**
- `cc-switch database not found` → 執行 `maw doctor`；確保 `~/.cc-switch/cc-switch.db` 存在，或設定 `CC_SWITCH_DB`。
- `DENY spawn: ... per-agent limit` → 某個工作階段超過 $1/分鐘；降低並發或調高 `--per-agent`。
- `codex not ready` → 安裝 `codex` 與 `codex-plugin-cc`；MAW 接著會對風險 ≥ 中等的情況降級為第二個 Claude Code 審查者。
- `no workflow.json; run maw plan first` → 執行 `maw plan --project .`。

## 10. 目錄結構

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

## 11. 安全性說明

- MAW 以**唯讀**方式讀取 cc-switch（在 `readOnly: true` 模式下使用 `node:sqlite`；永不變更供應商資料）。
- 它永不將機密寫入日誌。`doctor`/`cost` 會遮蔽認證權杖。
- Codex 審查路徑會呼叫 `codex-plugin-cc` 的配套腳本；MAW 不內嵌憑證。
- `PreToolUse` 鉤子僅**封鎖**超過成本/並發預算的生成 — 它不會修改工具輸入。
- 在重用任何外部程式碼前，我們已檢查：授權條款允許重用、無明顯安全風險、無隱藏的網路呼叫 / 憑證收集 / 危險的自動執行。詳見 [`NOTICE.md`](./NOTICE.md)。

## 12. 已知限制

- 成本護欄衡量的是**過去**的花費；突發流量可能在下一次日誌刷新前短暫超過限制。
- Codex 審查整合取決於是否安裝了 `codex-plugin-cc`；若未安裝，MAW 會以第二個 Claude Code 審查者替代（優雅降級，但並非 Codex）。
- 每智慧體的速率限制是按**工作階段**強制執行；共用同一工作階段 id 的智慧體會共用預算。
- 圖持久化在一個工作階段內恢復狀態；跨行程崩潰復原已列入路線圖。
- 尚未發布到 npm；在發布前請從克隆使用 `npx . install`。

## 13. 路線圖

- [ ] 以 `multi-agent-workflow` 名稱發布到 npm。
- [ ] 圖狀態的跨行程崩潰復原。
- [ ] 執行器中 LangGraph 風格的條件邊評估。
- [ ] 在基於花費的速率之外，提供每個智慧體的權杖預算推估。
- [ ] Gemini CLI / opencode 原生黏合層。
- [ ] 用於即時成本 + 並發監控的 Web UI。

## 14. 參考專案與致謝

我們研究了這些開源專案並採納了它們的**想法**（工作流排程、智慧體/角色管理、動態工作流生成、圖執行、迴圈控制、成本預算編列、外掛安裝、多智慧體訊息傳遞）。MAW 的實作是原創的；沒有任何專案被整體抄襲。關於借用了什麼以及為什麼，請見 [`NOTICE.md`](./NOTICE.md)。

- **Anthropic — *Building Effective Agents*** & ***How we built our multi-agent research system*** — 工作流與智慧體的區別、編排者-工人模式、子智慧體上下文壓縮、約 15 倍權杖成本意識，以及基於風險把關的評估。
- **LangChain / LangGraph** — 圖即節點與邊、宣告式結構 + 動態路徑、持久化/人工介入(HITL)、「困難之處在於每一步的上下文」。
- **Lilian Weng — *LLM Powered Autonomous Agents*** — ReAct/Reflexion 迴圈與反思機制。
- [`mbruhler/claude-orchestration`](https://github.com/mbruhler/claude-orchestration)（MIT）— 多智慧體編排外掛的版面配置。
- [`garyqlin/glink-engine`](https://github.com/garyqlin/glink-engine)（MIT）— 零相依的 YAML 圖引擎 + 共享事件匯流排。
- [`milanglacier/pi-dynamic-workflow`](https://github.com/milanglacier/pi-dynamic-workflow)（MIT）— 動態工作流選擇。
- [`srijansk/agent-relay`](https://github.com/srijansk/agent-relay)（MIT）— YAML 工作流 + 智慧體接力。
- [`x-glacier/SwarmFlow`](https://github.com/x-glacier/SwarmFlow)（Apache-2.0）— 多智慧體編排 + 成本意識。
- [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) — Codex 審查整合目標。
- **star-history**（開源）— GitHub Stars 趨勢圖（見下方章節）。

## 15. 貢獻者

- **imBlanker** — 初始實作。

> 歡迎貢獻。詳見 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。*（本節為佔位內容；未捏造其他貢獻者。）*

## 16. 聯絡方式

- 問題回報：<https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues>
- 作者：**imBlanker**（GitHub）— *聯絡資訊待補。*

*（聯絡資訊刻意保留為佔位內容；未捏造任何個人電子郵件或帳號。）*

---

## Testing

```bash
npm test        # 52 node:test cases (engine + CLI + installer + codex)
npm run smoke   # maw doctor + maw plan --self-test against this repo
npm run demo    # generate examples/.maw-sample
```

## GitHub Stars 趨勢

此圖表會自動讀取倉庫的星星數並自我更新 — 無需自架統計服務。它由開源專案 **[star-history](https://github.com/star-history/star-history)** 生成。

[![Star History](https://api.star-history.com/svg?repos=imBlanker/multi-agent-workflow-for-a-complicated-codebase&type=Date)](https://star-history.com/#imBlanker/multi-agent-workflow-for-a-complicated-codebase&Date)

---

授權條款：**MIT** — 詳見 [`LICENSE`](./LICENSE)。
