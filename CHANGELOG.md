# Changelog

All notable changes to **multi-agents-workflow (MAW)** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/). Agent-oriented summary: [`docs/AGENT_CHANGELOG.md`](docs/AGENT_CHANGELOG.md).

## [0.4.2] — 2026-08-18

### Fixed
- **Upgrade refresh now inherits the installed host** (0.4.2): the spawned `bin/mawf.js update` runs with `MAW_HOST` taken from `~/.maw/installed.json`, so a bare `mawf upgrade` on e.g. a dsh-install machine that also has `~/.claude` no longer re-detects as claude-code and lets the stale-asset cleanup purge the dsh skills.
- **Installing a second special host no longer drops the first** (union semantics): `MAW_HOST=pi mawf install` on a dsh install (or vice versa) now ships BOTH hosts' assets and records both dirs in the manifest — install never silently removes another host's assets; explicit removal stays `uninstall`. A bare `mawf update` on a multi-host machine likewise keeps every recorded host.
- `npm pkg fix`: `repository.url` normalized (no more publish warning).

## [0.4.1] — 2026-08-18

### Changed
- **`mawf upgrade` now refreshes installed templates by default** (npm and checkout modes): after a successful self-upgrade it spawns the NEW `bin/mawf.js update`, so host assets (commands/agents/skills/hooks) match the upgraded CLI without a manual follow-up. Opt out with `--no-apply-templates`; a refresh failure degrades to a warning — the upgrade itself stays successful.

### Fixed
- **Stale assets from older installs are now cleaned up.** `install`/`update` diff the previous v2 manifest against the files the current version writes and remove exactly the leftovers (no prefix scanning — user-added files are never touched), then prune emptied dirs. Fixes the 2026-08-18 incident where a 0.1.0-era install left `maw-*` skills/commands on disk next to the new `mawf-*` set, with a `hooks.json` pointing at a dead `bin/maw.js`, after the CLI itself had upgraded to 0.4.0. Legacy manifests without `files[]` are skipped (uninstall's prefix fallback still covers those).

## [0.4.0] — 2026-08-18

### Breaking
- **The `maw` command is removed.** Use `mawf` (the deprecated `maw` shim shipped in 0.2.0–0.2.1 is gone).
- Claude Code plugin slash commands renamed `/maw:*` → `/mawf:*` (`/mawf:plan`, `/mawf:run`, `/mawf:cost`, `/mawf:doctor`, `/mawf:add-agent`, `/mawf:review`).
- Portable skill bundles renamed `maw-*` → `mawf-*` (`mawf-loop`, `mawf-orchestration`, `mawf-graph`, `mawf-planner`, `mawf-cost-guard`).

### Changed
- Completed the rename sweep: every doc, badge, curl/clone URL, CI script fallback, help banner, and example now says `mawf` / `multi-agents-workflow` (one historical note retained in each README for discoverability).
- Uninstall/upgrade prefix-scan safety net now removes both legacy `maw-*` and new `mawf-*` files, so upgrading from ≤ 0.2.1 uninstalls cleanly.
- `npx multi-agents-workflow@latest install` is the canonical npm install command (package is published).

### Unchanged on purpose (compat with ≤ 0.2.1 installs)
- Project config dir `.maw/`, manifest dir `~/.maw`, env `MAW_HOST`, cc-switch snapshot dir `maw-backups/`, and per-agent pi files `.pi/agents/maw-*.md`.

### Added
- This changelog (English / 简体中文 / 繁體中文) and `docs/AGENT_CHANGELOG.md` for AI agents.

## [0.2.1] — 2026-08-18

### Fixed
- `--version` / `-v` now prints the version; `upgrade --dry-run` no longer reports "upgraded".

## [0.2.0] — 2026-08-18

### Breaking / Rename
- npm name `multi-agent-workflow` → **`multi-agents-workflow`** (the old unscoped name is an unrelated third-party package); bin `maw` → `mawf` (deprecated `maw` shim kept for one release); GitHub repo renamed with 301 redirects.

### Added
- `maw upgrade` self-upgrade command (git fork-first and npm global modes).
- Complete uninstall across all hosts with manifest-driven removal, optional config retention (`--keep-config` / `--purge-config`), and a prefix-scan safety net.
- DeepSeek Harness (dsh) host support: detection, provider/model reader, config generation, installer routing, doctor, docs.
- Model price gate (pause + human approval when a model is expensive); GitHub Actions tracker for `@mindfoldhq/trellis` updates; cc-switch project feature decoupled (code kept, disabled).

## [0.1.0] — 2026-08-05

### Added
- Initial MAW release: portable dynamic multi-agent workflow system for complex codebases — reads cc-switch config, selects architecture (loop / orchestrator-workers / multi-agent / graph / dynamic / ultracode), generates per-agent configs, enforces per-agent and total cost-rate limits via a `PreToolUse` guard, integrates Codex review.
- Capability-aware model selection, cc-switch read-only policy + pre-init snapshots, trellis-init chain, multilingual READMEs (en / zh-Hans / zh-Hant), agent-oriented install docs.
- Pi Agent host support: host detection, provider/model reader without cc-switch, config generation, installer routing, doctor, docs, tests.
