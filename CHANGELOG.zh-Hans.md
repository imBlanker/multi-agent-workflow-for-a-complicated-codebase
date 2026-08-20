# 变更日志

**multi-agents-workflow (MAW)** 的所有重要变更记录于此。
格式：[Keep a Changelog](https://keepachangelog.com/)；版本遵循
[SemVer](https://semver.org/)。

## [0.5.0] - 2026-08-20

### 新增

- **跨宿主库存** — `mawf inventory [--json] [--verify]`：扫描本机所有已安装受支持宿主（claude-code / codex / pi / dsh）+ 项目，产出 `.mawf/inventory.json` + 紧凑摘要。技能（带来源、symlink 去重）、插件、marketplaces、MCP、提示词面、完整可切换模型池（pi 合并 `models-store.json` 目录）。`--verify` 探测各宿主自身 CLI（`claude mcp list`、`codex mcp list --json`、dsh `--dump-config` everything-as-a-plugin 表）获取实时状态；仅 UI 可见的真相（claude 插件启用态、dsh 全量插件/技能、codex_apps）显式注明。
- **跨宿主建议** — `mawf advise [--task] [--difficulty 1-5] [--json] [--check-fresh]`：确定性逐宿主打分（capabilityFit/skillMatch/modelFit/costFit + stayBonus 滞回，margin ≥ 10 才建议切换），仅统计可用面（失败/待批准/禁用永不参与）。切换时：预生成 `.mawf/handoff/<时间戳>-<from>-<to>.md` 交接简报 + 确切启动命令（dsh：`kill -9 $(lsof -ti tcp:3080) && dsh web`）。advise 绝不执行任何命令。
- **主动注入** — 项目根 `AGENTS.md` + `CLAUDE.md` 幂等管理块（≤20 行）：任一宿主会话在会话开始与每天（UTC+8）首个提示词时重跑留守/切换分析（新鲜度状态存于 `.mawf/runtime/advise-state.json`），解析稳定的 `ADVISE-DONE` footer，主动呈现建议，填写/接续（<48h）交接简报。可逆：默认保留，`--purge-config` 移除。
- e2e CLI 测试（全链路 + 旧 `.maw` 迁移）；`docs/ROADMAP.md` — 10 项带教训出处的下一版改进项。

### 变更

- **`.maw` → `.mawf`** 全面改名（项目工作区、全局清单目录 `~/.mawf`、示例目录、文档）。CLI 入口一次性自动迁移：仅当 `.mawf` 不存在时改名旧目录；预存 `.mawf` 永远优先；绝不合并。
