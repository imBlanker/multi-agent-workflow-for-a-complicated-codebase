# 變更日誌

**multi-agents-workflow (MAW)** 的所有重要變更記錄於此。
格式：[Keep a Changelog](https://keepachangelog.com/)；版本遵循
[SemVer](https://semver.org/)。

## [0.5.0] - 2026-08-20

### 新增

- **跨宿主庫存** — `mawf inventory [--json] [--verify]`：掃描本機所有已安裝受支援宿主（claude-code / codex / pi / dsh）+ 项目，产出 `.mawf/inventory.json` + 緊湊摘要。技能（帶來源、symlink 去重）、插件、marketplaces、MCP、提示詞面、完整可切換模型池（pi 合并 `models-store.json` 目录）。`--verify` 探測各宿主自身 CLI（`claude mcp list`、`codex mcp list --json`、dsh `--dump-config` everything-as-a-plugin 表）獲取即時狀態；僅 UI 可見的真相（claude 插件启用态、dsh 全量插件/技能、codex_apps）顯式註明。
- **跨宿主建議** — `mawf advise [--task] [--difficulty 1-5] [--json] [--check-fresh]`：確定性逐宿主打分（capabilityFit/skillMatch/modelFit/costFit + stayBonus 滯回，margin ≥ 10 才建議切換），僅統計可用面（失敗/待批准/停用永不參與）。切換時：預生成 `.mawf/handoff/<时间戳>-<from>-<to>.md` 交接簡報 + 確切啟動命令（dsh：`kill -9 $(lsof -ti tcp:3080) && dsh web`）。advise 絕不執行任何命令。
- **主動注入** — 專案根 `AGENTS.md` + `CLAUDE.md` 冪等管理塊（≤20 行）：任一宿主會話在會話開始與每天（UTC+8）首個提示詞時重跑留守/切換分析（新鮮度狀態存於 `.mawf/runtime/advise-state.json`），解析穩定的 `ADVISE-DONE` footer，主動呈現建議，填寫/接續（<48h）交接簡報。可逆：預設保留，`--purge-config` 移除。
- e2e CLI 测试（全鏈路 + 舊 `.maw` 迁移）；`docs/ROADMAP.md` — 10 項帶教訓出處的下一版改進項。

### 變更

- **`.maw` → `.mawf`** 全面改名（專案工作區、全域清單目錄 `~/.mawf`、範例目錄、文件）。CLI 入口一次性自動遷移：僅當 `.mawf` 不存在时改名舊目录；預存 `.mawf` 永遠優先；絕不合併。
