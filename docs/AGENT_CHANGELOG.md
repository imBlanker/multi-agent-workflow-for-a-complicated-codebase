# Agent Changelog

Machine-oriented release summary for AI agents (installers, upgrade advisors,
coding agents operating this repo). Human narrative: [`../CHANGELOG.md`](../CHANGELOG.md)
(en / zh-Hans / zh-Hant). Rules of record: [`GOVERNANCE.md`](./GOVERNANCE.md) §5.

Package: `multi-agents-workflow` · CLI: `mawf` · Node ≥ 20.17 · zero runtime deps.

## 0.4.1 (2026-08-18)

```yaml
version: 0.4.1
semver_impact: patch
changed:
  - "upgrade refreshes installed templates by DEFAULT after a successful self-upgrade (npm AND checkout modes); spawns the NEW bin/mawf.js update; opt out with --no-apply-templates; refresh failure degrades to a warning (upgrade still ok)"
fixed:
  - "install/update now remove stale assets from an older install via exact v2-manifest diff + empty-dir pruning (no prefix scan; user files never touched); legacy manifests without files[] are skipped"
upgrade:
  npm: "npm i -g multi-agents-workflow@latest"
  checkout: "mawf upgrade"
smoke: "mawf doctor && mawf --version"
```

## 0.4.0 (2026-08-18)

```yaml
version: 0.4.0
semver_impact: minor # breaking command removals within 0.x
breaking:
  - command "`maw` removed → use `mawf` (shim deleted)"
  - slash commands "/maw:* → /mawf:*"
  - skill dirs "maw-* → mawf-* (mawf-loop, mawf-orchestration, mawf-graph, mawf-planner, mawf-cost-guard)"
compat_kept: [".maw/", "~/.maw", "MAW_HOST", "cc-switch maw-backups/", ".pi/agents/maw-*.md"]
fixed:
  - "uninstall/upgrade prefix-scan removes legacy maw-* AND new mawf-* files"
upgrade:
  npm: "npm i -g multi-agents-workflow@latest"
  checkout: "mawf upgrade"
smoke: "mawf doctor && mawf --version"
```

## 0.2.1 (2026-08-18)

```yaml
version: 0.2.1
semver_impact: patch
fixed: ["`--version`/`-v` prints version", "upgrade --dry-run no longer reports upgraded"]
```

## 0.2.0 (2026-08-18)

```yaml
version: 0.2.0
semver_impact: minor # rename release
breaking:
  - "npm name multi-agent-workflow → multi-agents-workflow (old name = unrelated third-party pkg)"
  - "bin maw → mawf (deprecated maw shim kept one release)"
added:
  - "maw upgrade: self-upgrade (git fork-first + npm global modes)"
  - "complete cross-host uninstall; manifest-driven; --keep-config/--purge-config"
  - "DeepSeek Harness (dsh) host support (detect/provider/configgen/installer/doctor)"
  - "model price gate (HITL pause on expensive models)"
  - "GitHub Actions tracker for @mindfoldhq/trellis updates"
  - "cc-switch project feature decoupled (code kept, disabled)"
```

## 0.1.0 (2026-08-05)

```yaml
version: 0.1.0
semver_impact: initial
added:
  - "portable dynamic multi-agent workflow for complex codebases"
  - "architecture selection: loop/orchestrator-workers/multi-agent/graph/dynamic/ultracode"
  - "per-agent config generation; PreToolUse cost-rate guard; Codex review integration"
  - "cc-switch read-only policy + pre-init snapshots; capability-aware model selection"
  - "Pi Agent host support; READMEs en/zh-Hans/zh-Hant; agent install docs"
```
