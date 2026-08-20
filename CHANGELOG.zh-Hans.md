# 变更日志

**multi-agents-workflow (MAW)** 的所有重要变更记录于此。
格式：[Keep a Changelog](https://keepachangelog.com/)；版本遵循
[SemVer](https://semver.org/)。

## [未发布]

### 变更

- **`.maw` → `.mawf`**：项目工作区、全局清单目录 `~/.mawf`、示例目录与全部文档统一改名。CLI 入口做一次性自动迁移：仅当新目录不存在时改命名旧目录（已存在的 `.mawf` 永远优先；绝不合并）。
- 主动跨宿主编排（inventory / advise / 注入管理块）详见 README §10 与 `docs/ARCHITECTURE.md` §10。

### 新增

- `docs/ROADMAP.md`：下一版改进项，逐条带教训出处（uninstall --dry-run、插件启用态探测、dsh 全量真相、codex_apps、库存漂移自检、探测重试、目录模型定价、捕获真实输出的 smoke、堆叠 PR 卫生）。

面向 AI 智能体的摘要：[`docs/AGENT_CHANGELOG.md`](docs/AGENT_CHANGELOG.md)。

## [0.4.2] — 2026-08-18

### 修复
- **升级刷新继承已装宿主**（0.4.2）：spawn 的 `bin/mawf.js update` 会带上从 `~/.maw/installed.json` 读取的 `MAW_HOST`，因此在一台 dsh 安装且同时存在 `~/.claude` 的机器上裸跑 `mawf upgrade`，不会再被重检测为 claude-code、进而让残留清理误删 dsh 技能。
- **安装第二特殊宿主不再清除第一宿主**（并集语义）：在 dsh 安装上执行 `MAW_HOST=pi mawf install`（或反向）现在会同时分发两个宿主的资产，并在清单中同时记录两个目录——install 绝不静默移除另一宿主的资产；显式移除仍走 `uninstall`。多宿主机器上的裸 `mawf update` 同样保留全部已记录宿主。
- `npm pkg fix`：规范化 `repository.url`（不再有发布警告）。

## [0.4.1] — 2026-08-18

### 变更
- **`mawf upgrade` 默认自动刷新已装模板**（npm 与 checkout 两种模式）：自升级成功后自动 spawn 新版的 `bin/mawf.js update`，宿主资产（commands/agents/skills/hooks）随 CLI 同步更新，无需手动跟进。用 `--no-apply-templates` 退出；刷新失败仅降级为警告——升级本身仍算成功。

### 修复
- **清理旧版安装的残留资产。**`install`/`update` 会将旧 v2 清单与当前版本写入的文件做精确差异比对，删除恰好属于残留的文件（不做前缀扫描——绝不触碰用户自建文件），并修剪变空的目录。修复 2026-08-18 事故：0.1.0 时代的安装在新版 `mawf-*` 落盘后仍遗留 `maw-*` skills/commands，且 `hooks.json` 指向已不存在的 `bin/maw.js`，而 CLI 本体早已升到 0.4.0。无 `files[]` 的 legacy 清单会跳过清理（显式 uninstall 的前缀兜底仍覆盖该场景）。

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
