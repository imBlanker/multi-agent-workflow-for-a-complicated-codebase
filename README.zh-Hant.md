[English](./README.md) | [简体中文](./README.zh-Hans.md) | [繁體中文](./README.zh-Hant.md)

[![CI](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml/badge.svg)](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-69%20passing-success.svg)](#testing)
[![GitHub stars](https://img.shields.io/github/stars/imBlanker/multi-agent-workflow-for-a-complicated-codebase?style=social&label=Stars)](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/stargazers)

# MAW — 面向複雜程式碼庫的多智慧體工作流系統

> 一個可攜、**動態**的多智慧體工作流系統。面對全新的複雜專案，MAW 會讀取你的 [cc-switch](https://github.com/farion1231/cc-switch) 設定，探測程式碼庫，並挑選合適的智慧體架構 —— *迴圈工程*、*編排者-工人*（子智慧體）、*多智慧體*、*圖工作流*、*動態工作流* 或 *ultracode* —— 或其組合。它為每個智慧體產生可獨立編輯的設定，強制執行**真實消費的成本速率限制**，並透過 [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) 整合 **Codex 審查**。

> **支援的宿主：僅 Claude Code 與 Codex。** 其他智慧體軟體（Gemini CLI、opencode……）刻意**不予**支援。

---

## 🍴 先 fork

**強烈建議：在使用前先 fork 本儲存庫。** 在*你的* fork 中進行任何個人修改，使其與此上游保持同步，並將改進與心得回饋至此。

- **Fork：** <https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/fork>
- **分支命名（Conventional Commits）：** `feat/<topic>`、`fix/<issue>`、`docs/<topic>`、`chore/<topic>`、`refactor/<topic>`、`ci/<topic>`、`test/<topic>`。
- **禁止直接推送至 `main`** —— 從你的功能分支發起 Pull Request。
- **一個 PR 對應一個關注點**，小而聚焦；用 `Closes #N` 連結 issue；CI 必須通過後才能審查。
- **issue：** 先搜尋[現有 issue](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues?q=is%3Aissue) 以避免重複，再使用 [bug](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues/new?template=bug_report.md) / [feature](https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues/new?template=feature_request.md) 模板。

完整規則見 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 與 [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md)。參見 [§貢獻者](#15-貢獻者) 與 [§聯絡方式](#16-聯絡方式)。

---

## 人類指南

> **提示：你可以把整份 README 交給你的智慧體，讓它為你安裝並設定 MAW —— 見下方 [Agent 指南](#agent-指南)。**

MAW 是一個 CLI（`maw`）加上一個 Claude Code 外掛。最快路徑：

```bash
# 1. Fork the repo (see 🍴 Fork first), then clone YOUR fork:
git clone https://github.com/<you>/multi-agent-workflow-for-a-complicated-codebase.git
cd multi-agent-workflow-for-a-complicated-codebase

# 2. Install the plugin + skills into Claude Code (and Codex, best-effort):
npx . install          # or: node bin/maw.js install

# 3. Initialize a project (this also creates a NEW cc-switch project profile):
maw init -u <your-name>

# 4. The next step is automatic: MAW runs `trellis init -u <your-name>` for you.
#    (skip the trellis chain with --no-trellis)

# 5. Plan + run:
maw plan --project .
maw run
```

若 Claude Code 的路由／自動故障轉移在 cc-switch 中為關閉，一條指令即可修復（只寫入 claude/codex 的 `proxy_config` 列 —— 絕不動你的設定檔／供應商）：

```bash
maw routing --fix
```

隨時檢查環境：`maw doctor`。

## Agent 指南

> **把這段交給你的智慧體（Claude Code、Codex、Cursor……）。它會為使用者正確地安裝、設定並使用 MAW。**

取得完整的智慧體安裝／設定指南並從頭到尾遵循 —— 不要摘要：

```bash
curl -fsSL https://raw.githubusercontent.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/main/docs/AGENT_INSTALL.md
```

該指南涵蓋：fork 與 clone、`npx . install`、`maw init -u <user>`（建立 cc-switch 專案設定檔＋檢查路由策略＋鏈接 `trellis init`）、`maw plan`、`maw run`、`maw cost`、`maw guard`、`maw review`、[人類指南](#人類指南) 工作流、[cc-switch 策略](#7-cc-switch-整合與路由策略)、[trellis init 規則](#8-trellis-init-作為強制的下一步)、優雅降級與解除安裝。完整閱讀；不要猜測。

最小智慧體提示：*"依循 https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase 中的 `docs/AGENT_INSTALL.md` 安裝並設定 MAW，然後對此專案執行 `maw plan`，並回報所選架構、智慧體與成本限制。"*

---

## 目錄
1. [專案目標](#1-專案目標)
2. [何時使用](#2-何時使用)
3. [系統架構](#3-系統架構)
4. [支援的智慧體軟體](#4-支援的智慧體軟體)
5. [工作流選擇機制](#5-工作流選擇機制)
6. [智慧體與子智慧體設定](#6-智慧體與子智慧體設定)
7. [cc-switch 整合與路由策略](#7-cc-switch-整合與路由策略)
8. [trellis init 作為強制的下一步](#8-trellis-init-作為強制的下一步)
9. [成本控制機制](#9-成本控制機制)
10. [安裝](#10-安裝)
11. [使用範例](#11-使用範例)
12. [目錄結構](#12-目錄結構)
13. [安全性說明](#13-安全性說明)
14. [已知限制](#14-已知限制)
15. [貢獻者](#15-貢獻者)
16. [聯絡方式](#16-聯絡方式)

## 1. 專案目標
- **動態，而非固定。** MAW 依據真實專案訊號＋宿主能力對六種架構評分，挑選最適配者 —— 或其組合。見 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。
- **可攜＋限定智慧體軟體。** 僅 Claude Code 與 Codex（依策略收窄）。規劃＋各智慧體設定為宿主可讀的純 JSON/YAML/Markdown。
- **成本有界。** 來自 cc-switch 日誌的真實推理消費，而非權杖估計。預設：**每智慧體 $1/分鐘**、**總計 $10/分鐘**、最大並發 4 —— 皆可編輯。
- **Codex 審查，依風險設關卡。** 當 [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) 可用時，Codex 在基於風險的關卡擔任獨立審查者 —— 而非每一步。
- **cc-switch 安全。** 既有 cc-switch 資料皆為唯讀；MAW 只建立新的專案設定檔與（可選）路由豁免。

## 2. 何時使用
**全新的複雜專案**：`maw init -u <user>` → `maw plan`。當單一智慧體不敷使用（檔案繁多、多種語言、高風險、上下文超出單一視窗）且你需要有成本上限的多智慧體執行與 Codex 審查關卡時使用。**不要**用於微小的固定任務（單一迴圈工程智慧體更便宜）。

## 3. 系統架構
```
   user/project → maw plan: probe → score architectures → select → generate per-agent configs (.maw/)
        │
   ┌────┴───────────────────────────────────────────────────────┐
   ▼              ▼                                            ▼
 cc-switch      host agent (Claude Code)              codex-plugin-cc (Codex reviewer)
 (SQLite, RO)   drives execute via Task/delegate     risk-gated review gates
 providers,     │
 model_pricing, ▼
 request_logs   cost guard (pre-spawn): $/min per-agent + total, concurrency cap
```
- **引擎**（`src/`）：[`ccswitch.js`](./src/ccswitch.js)（唯讀 DB＋專案設定檔建立＋路由）、[`planner.js`](./src/planner.js)、[`graph.js`](./src/graph.js)、[`configgen.js`](./src/configgen.js)、[`cost.js`](./src/cost.js)、[`codex.js`](./src/codex.js)、[`trellis.js`](./src/trellis.js)、[`installer.js`](./src/installer.js)、[`doctor.js`](./src/doctor.js)、[`host.js`](./src/host.js)、[`probe.js`](./src/probe.js)。
- **外掛**（`plugin/`）：Claude Code 指令（`/maw:plan`、`/maw:run`、`/maw:cost`、`/maw:doctor`、`/maw:add-agent`、`/maw:review`）、智慧體定義、一個 `PreToolUse` 成本護欄 hook。
- **技能**（`skills/`）：可攜的技能檔案。

## 4. 支援的智慧體軟體
| 宿主 | 狀態 | 說明 |
|---|---|---|
| **[Claude Code](https://docs.claude.com/en/docs/claude-code)** | ✅ 完整 | 指令、智慧體、hook、技能；原生 `Task`/delegate 支援子智慧體與多智慧體；**本地路由＋自動故障轉移恆為開啟**。 |
| **[Codex](https://github.com/openai/codex)** | ✅ 支援 | 智慧體定義＋透過 [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) 的審查者；除非 OpenAI OAuth 登入，否則本地路由為開啟。 |
| Gemini CLI / opencode / 其他 | ❌ 不支援 | （其 cc-switch 定價仍可能被讀取用於成本估計。） |

`maw doctor` 回報宿主＋路由策略合規性。

## 5. 工作流選擇機制
| 訊號 | 可能選擇 |
|---|---|
| 微小、固定、低風險 | `none`（單次呼叫） |
| 開放式、步驟不可預測、單一上下文 | `loop` |
| 多個可動態並行化的子任務／上下文超出單一視窗 | `orchestrator-workers` |
| 高價值廣度優先、並行、可容忍約 15× 成本 | `multi-agent` |
| 需要可預測性、人工介入(HITL)、持久化、分支 | `graph` |
| 宿主具原生動態工作流／多智慧體 | `dynamic`（疊加其上） |
| 複雜程式碼撰寫＋codex 審查可用 | `ultracode`（圖工作流 + 迴圈工程 + codex 修復關卡） |

架構可**組合**（例如 `ultracode` = `graph` + `loop` + 一個 Codex 審查關卡）。完整評分表：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 6. 智慧體與子智慧體設定
`maw plan` 在 `.maw/` 下為每個角色寫入**可獨立編輯**的設定（`workflow.json`、`config.yaml`、`plan.md`、`graph.json`、`agents/<role>.md`+`.json`、`runtime/`）。動態新增／移除：`maw add-agent --role <r> ...`／`maw remove-agent --role <r>`。直接編輯任一檔案 —— 執行器會在執行時重新讀取。

## 7. cc-switch 整合與路由策略
MAW 預設將你的 cc-switch 視為**唯讀**。以下規則在程式碼中強制執行（[`src/ccswitch.js`](./src/ccswitch.js)、`guardSql`）：

- **既有 cc-switch 資料皆為唯讀。** 讀取使用唯讀 SQLite 連線（`node:sqlite` `readOnly:true`）。
- **每次 init 一個新專案。** `maw init -u <user>` 建立一個全新的 cc-switch **專案**（`profiles` 表中的一列），命名為 `MAW: <project> (<user>)`，範圍限定於 claude+codex。供應商／MCP／技能／記憶體**只在此新專案的 payload 內**供應。
- **絕不碰 `默认` 設定檔。** 任何名稱含 `默认`（例如 `Claude Code 默认`、`Codex 默认`）的設定檔**絕不**被寫入、更新或刪除 —— 一道硬性護欄會予以拒絕。
- **路由規則**（`maw routing`／`maw doctor` 檢查；`maw routing --fix` 套用豁免，**只**寫入 claude/codex 的 `proxy_config`）：
  - **Claude Code：** 本地路由**恆為開啟**＋自動故障轉移**恆為開啟**。
  - **Codex：** 當使用 **OpenAI OAuth（ChatGPT）登入** 時 → 本地路由**關閉**；否則**開啟**。（OAuth 由 `codex_oauth_auth.json`＋供應商的 `auth.auth_mode === "chatgpt"` 偵測。）

## 8. trellis init 作為強制的下一步
**務必在 `maw init` 之後立即執行 `trellis init -u <user-name>`。** MAW 會自動為你完成（它呼叫 [`@mindfoldhq/trellis`](https://github.com/mindfoldhq/trellis) —— 一個更強大、更嚴謹的工作流框架）。使用 `maw init --no-trellis` 跳過。

由於 trellis 與 MAW 都能管理檔案，發生衝突時 MAW 會**暫停** trellis init：
1. **快照** MAW 管理的檔案（`.maw/*`，排除 `runtime/`／`logs/`）。
2. **執行** `trellis init -u <user> -y --claude --codex`，將輸出串流至 `.maw/logs/trellis-init-<timestamp>.log`。
3. **偵測** trellis 動過的任何 MAW 管理檔案 → **暫停**，在終端機印出衝突詳情＋概覽＋日誌路徑。
4. **你逐項選擇**：`[m]` 保留 MAW（透過 `maw plan` 重新產生）· `[t]` 保留 trellis · `[r]` 重新執行 trellis init 以**恢復進度**。
5. MAW 套用你的選擇並繼續。

（黑箱 CLI 無法在寫入途中暫停，因此 MAW 在衝突寫入後立即偵測，再透過重新執行冪等的 `trellis init` 來恢復。）見 [`src/trellis.js`](./src/trellis.js)。

## 9. 成本控制機制
來自 cc-switch `proxy_request_logs` 的真實推理消費 → USD/分鐘。**每智慧體** $1/分鐘、**總計** $10/分鐘（獨立）、**最大並發** 4 —— 可在 `.maw/config.yaml` 或透過旗標編輯。定價來源鏈：cc-switch `model_pricing` → 供應商 `cost_multiplier` → 內建**估計值**（標記 `estimated:true`）→ `null`（絕不偽造）。

```bash
maw cost      # current rate + top sessions + used% vs limit
maw guard     # ALLOW/DENY a new spawn right now (pre-spawn check)
maw acquire --id <id> --role <r>   # take a slot
maw release --id <id>             # release a slot
```

## 10. 安裝
**來自 npm（一旦發布）：** `npx multi-agent-workflow install`。
**來自 fork／clone（目前）：**
```bash
git clone https://github.com/<you>/multi-agent-workflow-for-a-complicated-codebase.git
cd multi-agent-workflow-for-a-complicated-codebase
npx . install          # or node bin/maw.js install
```
`install` 將指令／智慧體／hook／技能複製進 Claude Code（並盡力處理 Codex），把 manifest 寫入 `~/.maw/installed.json`，且為非破壞性（解除安裝只移除 `maw-*` 檔案）。`update` 重新複製模板，保留你的編輯。

## 11. 使用範例
**最小：** `maw init -u alice` → `maw plan --project .` → `maw run` → `maw cost`。
**完整：** `maw plan --project . --task-type coding --risk high --parallel 6 --value high --context large` → 每次產生前執行 `maw guard` → `maw acquire/release` → `maw review --after post-implementation`。
見 [`examples/complex-project-workflow.md`](./examples/complex-project-workflow.md) 與產生的 [`examples/.maw-sample/`](./examples/.maw-sample/)。

**常見錯誤：** `cc-switch database not found` → `maw doctor`；`DENY spawn ... per-agent limit` → 降低並發或調高 `--per-agent`；`codex not ready` → 安裝 codex＋codex-plugin-cc（MAW 在風險 ≥ 中等時降級為第二個 Claude 審查者）；`routing NOT compliant` → `maw routing --fix`。

## 12. 目錄結構
```
bin/maw.js  src/  plugin/  skills/  defaults/  examples/  tests/  docs/
.github/workflows/ci.yml  README.{md,zh-Hans,zh-Hant}  LICENSE(MIT)
```

## 13. 安全性說明
cc-switch 為唯讀；唯一的寫入為 (a) 一個新專案設定檔與 (b) claude/codex 的可選 `proxy_config` 豁免 —— 兩者皆有硬性護欄（無 `DELETE`／`DROP`，對 profiles／providers／skills 無 `UPDATE`，絕不作用於 `默认`）。`PreToolUse` hook 只**阻擋**超預算的產生。外部程式碼在重用前已審查（授權條款＋無隱藏網路／憑證竊取）—— 見 [`NOTICE.md`](./NOTICE.md)、[`ACKNOWLEDGEMENTS.md`](./ACKNOWLEDGEMENTS.md)。

## 14. 已知限制
- 尚未上架 npm（使用 `npx . install`）。
- 成本護欄衡量的是**過去**消費；短時間尖峰可能短暫超過限制。
- Codex 審查依賴 codex-plugin-cc；若無，MAW 以第二個 Claude 審查者替代。
- 路由豁免直接寫入 cc-switch 的 SQLite；cc-switch GUI 可能需要重新啟動才會反映。
- 跨進程圖工作流崩潰恢復已列入規劃。

## 15. 貢獻者
- **imBlanker** —— 初始實作。
> 歡迎貢獻 —— 見 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 與 [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md)。*(未捏造其他貢獻者。)*

## 16. 聯絡方式
- issue：<https://github.com/imBlanker/multi-agent-workflow-for-a-complicated-codebase/issues>
- 作者：**imBlanker**（GitHub）。*(聯絡資訊待補；未捏造。)*

---

<a id="testing"></a>
## 測試
```bash
npm test        # 69 node:test cases
node bin/maw.js doctor
```

## GitHub Stars 趨勢
頂部的徽章恆顯示即時星數（透過 [shields.io](https://shields.io)）。下方的趨勢圖由開源專案 **[star-history](https://github.com/star-history/star-history)** 產生 —— 它會自動讀取 GitHub 星數並自行更新。對全新儲存庫可能需要時間才會填入；若內嵌圖片為空白，請開啟[互動式圖表](https://star-history.com/#imBlanker/multi-agent-workflow-for-a-complicated-codebase&Date)。

[![Star History Chart](https://api.star-history.com/svg?repos=imBlanker/multi-agent-workflow-for-a-complicated-codebase&type=Date)](https://star-history.com/#imBlanker/multi-agent-workflow-for-a-complicated-codebase&Date)

---

授權條款：**MIT** —— 見 [`LICENSE`](./LICENSE)。
