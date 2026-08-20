# Changelog

All notable changes to **multi-agents-workflow (MAW)** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/). Agent-oriented summary: [`docs/AGENT_CHANGELOG.md`](docs/AGENT_CHANGELOG.md).

## [0.5.0] - 2026-08-20

### Added

- **Cross-host inventory** — `mawf inventory [--json] [--verify]`: scans ALL installed supported hosts (claude-code / codex / pi / dsh) plus the project into `.mawf/inventory.json` + a compact digest. Skills (origin-tagged, symlink-deduped by real path), plugins, marketplaces, MCP servers, prompt surfaces, and the full switchable model pool (pi merges `models-store.json` catalogs). `--verify` probes each host's own CLI (`claude mcp list`, `codex mcp list --json`, dsh `--dump-config` everything-as-a-plugin table) for live statuses; UI-only truths (claude plugin enable-state, dsh full plugin/skill list, codex_apps) stay explicitly documented.
- **Cross-host advising** — `mawf advise [--task] [--difficulty 1-5] [--json] [--check-fresh]`: deterministic per-host scoring (capabilityFit/skillMatch/modelFit/costFit + stayBonus hysteresis, margin ≥ 10 to switch), usable surfaces only (failed/pending/disabled never match). On switch: pre-created `.mawf/handoff/<ts>-<from>-<to>.md` brief + the exact launch command (dsh: `kill -9 $(lsof -ti tcp:3080) && dsh web`). Advise never executes anything.
- **Proactive injection** — idempotent managed block (≤20 lines) in the project root `AGENTS.md` + `CLAUDE.md`: any host session re-runs the stay/switch analysis at session start and on the first prompt of each day (UTC+8, freshness state in `.mawf/runtime/advise-state.json`), parses the stable `ADVISE-DONE` footer, surfaces recommendations, fills/picks up handoff briefs (<48h). Reversible: keep by default, `--purge-config` strips.
- e2e CLI tests (full chain + legacy `.maw` migration); `docs/ROADMAP.md` — 10 lesson-backed next-version improvement items.

### Changed

- **`.maw` → `.mawf`** everywhere (project workspace, global manifest dir `~/.mawf`, sample dirs, docs). One-time auto-migration at CLI entry: legacy dirs renamed only when `.mawf` is absent; pre-existing `.mawf` always wins; never merges.
