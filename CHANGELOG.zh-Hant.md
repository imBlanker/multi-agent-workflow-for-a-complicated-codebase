# 變更日誌

**multi-agents-workflow (MAW)** 的所有重要變更記錄於此。
格式：[Keep a Changelog](https://keepachangelog.com/)；版本遵循
[SemVer](https://semver.org/)。面向 AI 智慧體的摘要：[`docs/AGENT_CHANGELOG.md`](docs/AGENT_CHANGELOG.md)。

## [0.4.0] — 2026-08-18

### 破壞性變更
- **移除 `maw` 指令。**請使用 `mawf`（0.2.0–0.2.1 附帶的廢棄 `maw` 相容墊片已刪除）。
- Claude Code 外掛斜線指令由 `/maw:*` 更名為 `/mawf:*`（`/mawf:plan`、`/mawf:run`、`/mawf:cost`、`/mawf:doctor`、`/mawf:add-agent`、`/mawf:review`）。
- 可移植技能包由 `maw-*` 更名為 `mawf-*`（`mawf-loop`、`mawf-orchestration`、`mawf-graph`、`mawf-planner`、`mawf-cost-guard`）。

### 變更
- 完成更名清掃：所有文件、徽章、curl/clone URL、CI 腳本回退、說明橫幅與範例均改為 `mawf` / `multi-agents-workflow`（每個 README 保留一條歷史說明便於檢索）。
- 解除安裝/升級的前綴掃描安全網現在同時清理舊 `maw-*` 與新 `mawf-*` 檔案，從 ≤ 0.2.1 升級可乾淨解除安裝。
- `npx multi-agents-workflow@latest install` 成為標準 npm 安裝指令（套件已發布）。

### 刻意保持不變（相容 ≤ 0.2.1 安裝）
- 專案設定目錄 `.maw/`、清單目錄 `~/.maw`、環境變數 `MAW_HOST`、cc-switch 快照目錄 `maw-backups/`、pi 智慧體檔案 `.pi/agents/maw-*.md`。

### 新增
- 本變更日誌（English / 簡體中文 / 繁體中文）及面向 AI 智慧體的 `docs/AGENT_CHANGELOG.md`。

## [0.2.1] — 2026-08-18

### 修復
- `--version` / `-v` 現在正確輸出版本號；`upgrade --dry-run` 不再誤報「已升級」。

## [0.2.0] — 2026-08-18

### 破壞性變更 / 更名
- npm 套件名 `multi-agent-workflow` → **`multi-agents-workflow`**（舊未加作用域名稱屬於無關第三方套件）；指令 `maw` → `mawf`（保留一個版本的廢棄墊片）；GitHub 儲存庫更名並 301 重定向。

### 新增
- `maw upgrade` 自我升級指令（git fork 優先與 npm 全域兩種模式）。
- 跨全部宿主的完整解除安裝：清單驅動刪除、可選設定保留（`--keep-config` / `--purge-config`）與前綴掃描安全網。
- DeepSeek Harness (dsh) 宿主支援：偵測、供應商/模型讀取、設定生成、安裝器路由、doctor、文件。
- 模型價格閘門（模型昂貴時暫停並請求人工確認）；`@mindfoldhq/trellis` 更新的 GitHub Actions 追蹤器；cc-switch 專案特性解耦（保留程式碼、預設停用）。

## [0.1.0] — 2026-08-05

### 新增
- MAW 初始版本：面向複雜程式碼庫的可移植動態多智慧體工作流系統——讀取 cc-switch 設定、選擇架構（loop / orchestrator-workers / multi-agent / graph / dynamic / ultracode）、生成各智慧體設定、透過 `PreToolUse` 守衛執行單智慧體與總成本費率限制、整合 Codex 審查。
- 能力感知的模型選擇、cc-switch 唯讀策略 + 初始化前快照、trellis-init 鏈、多語言 README（en / zh-Hans / zh-Hant）、面向智慧體的安裝文件。
- Pi Agent 宿主支援：宿主偵測、無 cc-switch 的供應商/模型讀取、設定生成、安裝器路由、doctor、文件與測試。
