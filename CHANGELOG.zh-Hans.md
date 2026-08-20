# 变更日志

**multi-agents-workflow (MAW)** 的所有重要变更记录于此。
格式：[Keep a Changelog](https://keepachangelog.com/)；版本遵循
[SemVer](https://semver.org/)。

## [0.5.1] - 2026-08-20

### 修复

- **doctor：dsh profile 列表不再把 `node_modules` 误报为 profile。** 新增专用读取器 `listDshProfiles()`（`src/dshprovider.js`）：仅枚举真实 profile 目录——跳过 `node_modules` 与点前缀目录，`profiles/` 缺失时安全降级为 `[]`。附回归测试。

### 验证

- 与 **DeepSeek Harness (dsh) 0.1.0-rc.8** 兼容性验证通过：`agent-default-model` dump 行与 rc.6 逐字节一致（provider/model 提取不受影响）；`settings.yaml` `llm-pi-ai.providers` 结构不变；`mawf inventory --verify` 在扩容后的 everything-as-a-plugin 表上无重复、无错报；`mawf advise` 评分正常；MAW 从不读取 dsh 会话存储，rc.8 的 SQLite 格式不兼容对 MAW 无影响；措辞符合 rc.8 品牌规范（描述性使用 "DeepSeek Harness (dsh)" 被明确允许）。

## [0.5.0] - 2026-08-20

### 新增

- **跨宿主库存** — `mawf inventory [--json] [--verify]`：扫描本机所有已安装受支持宿主（claude-code / codex / pi / dsh）+ 项目，产出 `.mawf/inventory.json` + 紧凑摘要。技能（带来源、symlink 去重）、插件、marketplaces、MCP、提示词面、完整可切换模型池（pi 合并 `models-store.json` 目录）。`--verify` 探测各宿主自身 CLI（`claude mcp list`、`codex mcp list --json`、dsh `--dump-config` everything-as-a-plugin 表）获取实时状态；仅 UI 可见的真相（claude 插件启用态、dsh 全量插件/技能、codex_apps）显式注明。
- **跨宿主建议** — `mawf advise [--task] [--difficulty 1-5] [--json] [--check-fresh]`：确定性逐宿主打分（capabilityFit/skillMatch/modelFit/costFit + stayBonus 滞回，margin ≥ 10 才建议切换），仅统计可用面（失败/待批准/禁用永不参与）。切换时：预生成 `.mawf/handoff/<时间戳>-<from>-<to>.md` 交接简报 + 确切启动命令（dsh：`kill -9 $(lsof -ti tcp:3080) && dsh web`）。advise 绝不执行任何命令。
- **主动注入** — 项目根 `AGENTS.md` + `CLAUDE.md` 幂等管理块（≤20 行）：任一宿主会话在会话开始与每天（UTC+8）首个提示词时重跑留守/切换分析（新鲜度状态存于 `.mawf/runtime/advise-state.json`），解析稳定的 `ADVISE-DONE` footer，主动呈现建议，填写/接续（<48h）交接简报。可逆：默认保留，`--purge-config` 移除。
- e2e CLI 测试（全链路 + 旧 `.maw` 迁移）；`docs/ROADMAP.md` — 10 项带教训出处的下一版改进项。

### 变更

- **`.maw` → `.mawf`** 全面改名（项目工作区、全局清单目录 `~/.mawf`、示例目录、文档）。CLI 入口一次性自动迁移：仅当 `.mawf` 不存在时改名旧目录；预存 `.mawf` 永远优先；绝不合并。
