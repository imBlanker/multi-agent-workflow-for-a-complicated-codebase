# AGENTS.md

<!-- mawf:cross-host-advise BEGIN -->
## MAW cross-host advising (managed block — edit outside the markers only)

This machine runs several supported agent hosts (claude/codex/pi/dsh). Act for the human:

1. Session start AND first prompt of each day (UTC+8): run `mawf advise --check-fresh`;
   when STALE, run `mawf advise --task "<current task>"` (no --task → project plan profile).
2. Parse the trailing `ADVISE-DONE recommendation=… target=… margin=… handoff=…` line.
3. On `switch`: fill the pre-created handoff brief (path from handoff=), then present the
   recommendation + reasons and the exact launch command (dsh: `kill -9 $(lsof -ti tcp:3080) && dsh web`).
   NEVER execute the launch command yourself — the human runs it.
4. Session start: if `.mawf/handoff/` has a brief newer than 48h, offer to continue it.
5. Before claiming a tool/model/skill is missing on this machine, check `.mawf/inventory-digest.md`
   (another host may have it; `mawf inventory --verify` refreshes live MCP/plugin status).

Advice is advisory — you propose, the human decides. Removed by `mawf uninstall --purge-config`.
<!-- mawf:cross-host-advise END -->
