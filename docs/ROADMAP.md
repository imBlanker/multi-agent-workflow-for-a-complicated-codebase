# mawf Roadmap — next-version improvement items

> Living backlog. Every item carries its provenance (the lesson that produced it).
> Items graduate into CHANGELOG entries when shipped. Historical changelogs are
> never rewritten.

## Proposed for the next minor version (0.5.x)

### R1. `mawf uninstall --dry-run`

- **Lesson (2026-08-20 incident):** a manual purge verification ran against the
  real HOME and uninstalled live host assets; recovery was `mawf install`.
  Verification flows must never require executing destructive commands.
- **Item:** `--dry-run` prints the exact removal list (manifest files[] +
  prefix-scan hits + purge targets) without touching the filesystem; also a
  `--json` mode. Test convention: uninstall verification only against
  `HOME=<tmpdir>` fixtures.

### R2. Probe claude plugin enable-state + plugin-provided skills

- **Lesson:** plugin enable state is not file-detectable (all 3 user plugins
  were disabled while `installed_plugins.json` lists them); plugin-provided
  skills are therefore excluded from inventory, understating claude-code.
- **Item:** `mawf inventory --verify` additionally parses `claude plugin list`
  (like it already does `claude mcp list`): attach `status: enabled|disabled`
  to plugins; when a plugin is enabled, count its skills/ dir (from the
  installPath recorded in `installed_plugins.json`).

### R3. dsh full plugin/skill truth via a CLI surface

- **Lesson:** dsh is everything-as-a-plugin, but the FULL plugin list (183 /
  154 active on the reference machine) and the builtin skill list (63) are
  visible only in the dsh web UI; `--dump-config` exposes 149 components.
  Inventory must not silently under-report.
- **Item:** upstream ask: a `dsh plugins list` / skills enumeration CLI (or an
  exported patch-layer manifest path). Until then, `inventory --verify` keeps
  the dump-config table + an explicit "web UI is the full truth" note; consider
  reading the web UI's storage file if a stable path exists.

### R4. codex_apps connector status

- **Lesson:** codex MCP list shows 6 auth-unsupported servers; the builtin
  `codex_apps` connector (official OpenAI features when connected) is visible
  only in the codex UI.
- **Item:** document + probe where codex persists the apps-connection state;
  surface it as a capability row in inventory with a UI-only caveat until a
  file/CLI source exists.

### R5. Inventory drift self-check (doctor integration)

- **Lesson:** heuristic scans drifted from host reality twice before being
  verified against each host's own introspection (`claude mcp list`,
  `codex mcp list --json`, pi docs, dsh dump-config).
- **Item:** `mawf doctor --verify-inventory` runs a static scan + CLI probe and
  reports drift (counts by category per host) so users can spot stale
  inventories; CI keeps hermetic fixtures, this stays opt-in/local.

### R6. Probe robustness: timeouts and retries

- **Lesson:** `claude mcp list` health output is nondeterministic (slow-failing
  servers may be omitted); statuses also change between runs
  (Failed → Pending approval). One retry was bolted on.
- **Item:** configurable probe policy (`inventory.probeRetries`,
  `inventory.probeTimeoutMs` in `.mawf/config.yaml`); capture per-server
  `lastSeen` status transitions in the JSON report.

### R7. Catalog-model pricing cross-ref (pi/dsh)

- **Lesson:** pi's switchable pool grew 5 → 19 after merging
  `models-store.json` catalogs, but catalog models carry no cost fields.
- **Item:** cross-ref catalog ids against cc-switch model_pricing (already
  partially wired) and, where still unknown, an optional OpenRouter/Artificial
  Analysis lookup behind a flag — always tagged `estimated` per the
  never-fake-exact pricing policy.

### R8. Captured-output smoke for humans

- **Lesson:** a fabricated "example output" was once reported as real
  (`SWITCH → dsh` vs actual `STAY`). Only real runs may be reported.
- **Item:** `mawf smoke --capture <dir>` writes REAL outputs (doctor,
  inventory --verify, advise on two canonical tasks) to files under the task/
  PR workspace so review gates always quote captured artifacts, never
  hand-written examples.

### R9. Stacked-PR hygiene helper

- **Lesson:** a fix commit landed on the wrong stacked branch and had to be
  cherry-picked back.
- **Item:** `CONTRIBUTING.md` note + optional `scripts/which-branch` hint that
  prints the current child-task branch mapping (Trellis task → git branch) to
  reduce mis-targeted commits in deep stacks.


### R10. `mawf install --all-hosts` (post-uninstall multi-host recovery)

- **Lesson:** after a real-HOME uninstall, a plain `mawf install` restored only
  the primary host's assets (the manifest was gone); pi/dsh/codex skill copies
  required per-host `MAW_HOST=<host> mawf install` runs, discovered manually.
  Also: legacy `codex-rescue` assets from older versions are removed by the
  uninstall prefix-scan and never re-shipped (by design, but surprising).
- **Item:** `--all-hosts` fans out installs for every detected host; document
  the recovery runbook (uninstall → which hosts need which re-install) in
  AGENT_INSTALL.md.

## Done in 0.4.x (kept for provenance)

- `.maw` → `.mawf` rename with one-time auto-migration (project + global
  `~/.mawf`), single choke point at CLI entry. Lesson: brand/path consistency.
- `mawf inventory --verify` probe mode; skill origins; marketplaces category;
  dsh dump-config plugin table (everything-as-a-plugin).
- pi switchable model pool = models.json + models-store.json catalogs.
- advise: usable-surface filter (failed/pending/disabled/unsupported MCPs and
  disabled dsh plugins never match).
