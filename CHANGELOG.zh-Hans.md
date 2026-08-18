# 变更日志

**multi-agents-workflow (MAW)** 的所有重要变更记录于此。
格式：[Keep a Changelog](https://keepachangelog.com/)；版本遵循
[SemVer](https://semver.org/)。面向 AI 智能体的摘要：[`docs/AGENT_CHANGELOG.md`](docs/AGENT_CHANGELOG.md)。

## [0.4.0] — 2026-08-18

### 破坏性变更
- **移除 `maw` 命令。**请使用 `mawf`（0.2.0–0.2.1 中附带的废弃 `maw` 兼容垫片已删除）。
- Claude Code 插件斜杠命令由 `/maw:*` 更名为 `/mawf:*`（`/mawf:plan`、`/mawf:run`、`/mawf:cost`、`/mawf:doctor`、`/mawf:add-agent`、`/mawf:review`）。
- 可移植技能包由 `maw-*` 更名为 `mawf-*`（`mawf-loop`、`mawf-orchestration`、`mawf-graph`、`mawf-planner`、`mawf-cost-guard`）。

### 变更
- 完成更名清扫：所有文档、徽章、curl/clone URL、CI 脚本回退、帮助横幅与示例均改为 `mawf` / `multi-agents-workflow`（每个 README 保留一条历史说明便于检索）。
- 卸载/升级的前缀扫描安全网现在同时清理旧 `maw-*` 与新 `mawf-*` 文件，从 ≤ 0.2.1 升级可干净卸载。
- `npx multi-agents-workflow@latest install` 成为标准 npm 安装命令（包已发布）。

### 刻意保持不变（兼容 ≤ 0.2.1 安装）
- 项目配置目录 `.maw/`、清单目录 `~/.maw`、环境变量 `MAW_HOST`、cc-switch 快照目录 `maw-backups/`、pi 智能体文件 `.pi/agents/maw-*.md`。

### 新增
- 本变更日志（English / 简体中文 / 繁體中文）及面向 AI 智能体的 `docs/AGENT_CHANGELOG.md`。

## [0.2.1] — 2026-08-18

### 修复
- `--version` / `-v` 现在正确输出版本号；`upgrade --dry-run` 不再误报“已升级”。

## [0.2.0] — 2026-08-18

### 破坏性变更 / 更名
- npm 包名 `multi-agent-workflow` → **`multi-agents-workflow`**（旧未加作用域名称属于无关第三方包）；命令 `maw` → `mawf`（保留一个版本的废弃垫片）；GitHub 仓库更名并 301 重定向。

### 新增
- `maw upgrade` 自升级命令（git fork 优先与 npm 全局两种模式）。
- 跨全部宿主的完整卸载：清单驱动删除、可选配置保留（`--keep-config` / `--purge-config`）与前缀扫描安全网。
- DeepSeek Harness (dsh) 宿主支持：检测、供应商/模型读取、配置生成、安装器路由、doctor、文档。
- 模型价格闸门（模型昂贵时暂停并请求人工确认）；`@mindfoldhq/trellis` 更新的 GitHub Actions 追踪器；cc-switch 项目特性解耦（保留代码、默认禁用）。

## [0.1.0] — 2026-08-05

### 新增
- MAW 初始版本：面向复杂代码库的可移植动态多智能体工作流系统——读取 cc-switch 配置、选择架构（loop / orchestrator-workers / multi-agent / graph / dynamic / ultracode）、生成各智能体配置、通过 `PreToolUse` 守卫执行单智能体与总成本费率限制、集成 Codex 评审。
- 能力感知的模型选择、cc-switch 只读策略 + 初始化前快照、trellis-init 链、多语言 README（en / zh-Hans / zh-Hant）、面向智能体的安装文档。
- Pi Agent 宿主支持：宿主检测、无 cc-switch 的供应商/模型读取、配置生成、安装器路由、doctor、文档与测试。
