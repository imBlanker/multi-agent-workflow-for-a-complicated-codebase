#!/usr/bin/env node
// DEPRECATED shim (kept for one release after the maw → mawf bin rename).
// The CLI was renamed to avoid a same-domain command collision (maw-js).
// This shim delegates to the real bin so muscle memory keeps working.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
process.stderr.write("[maw] deprecated: the command is now `mawf` (multi-agents-workflow). delegating…\n");
const real = path.join(path.dirname(fileURLToPath(import.meta.url)), "mawf.js");
const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
