// @ts-check
// Watchdog git safety: snapshot before Phase B writes (R8).
// Minimal Stage-3 core: branch-based snapshot + non-git detection + degrade.
// Full reconcile-after-recovery lands in Stage 4.
//
// Strategy: `git stash create` captures the dirty tree WITHOUT touching the
// working copy (safe with a live original agent still writing), then we
// create a rescue ref pointing at it: refs/rescue/<incident-id>. If stash
// create yields nothing (clean tree) we snapshot HEAD as the ref. Non-git
// project → { ok:false, nonGit:true } → Phase B is FORBIDDEN (incident forced
// to diagnose-only; rescue never writes). All git access via injectable
// runner (tests stub it; never shell out to anything else).
import { spawnSync } from "node:child_process";

/** @typedef {{ run?: (args: string[], cwd: string) => { status: number, stdout: string } }} GitOpts */

function runDefault(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? "") };
}

/**
 * Is this project a git repo? (`.git` present or `git rev-parse` succeeds)
 * @param {string} projectDir
 * @param {GitOpts} [opts]
 */
export function isGitProject(projectDir, opts = {}) {
  const run = opts.run ?? runDefault;
  return run(["rev-parse", "--is-inside-work-tree"], projectDir).status === 0;
}

/**
 * Create the pre-Phase-B snapshot. Returns the ref name on success.
 * @param {string} projectDir
 * @param {string} incidentId
 * @param {GitOpts} [opts]
 * @returns {{ ok: boolean, nonGit?: boolean, ref?: string, reason?: string }}
 */
export function ensureSnapshot(projectDir, incidentId, opts = {}) {
  const run = opts.run ?? runDefault;
  if (!isGitProject(projectDir, opts)) return { ok: false, nonGit: true, reason: "not a git repository — Phase B forbidden (diagnose-only)" };
  const ref = `refs/rescue/${incidentId}`;
  try {
    // stash create: captures tracked-file dirt without modifying the worktree
    const stash = run(["stash", "create", `mawf-rescue ${incidentId}`], projectDir);
    const sha = stash.status === 0 ? stash.stdout.trim() : "";
    if (sha) {
      const upd = run(["update-ref", ref, sha], projectDir);
      if (upd.status !== 0) return { ok: false, reason: `update-ref failed: ${upd.stdout}` };
      return { ok: true, ref };
    }
    // clean tree → snapshot HEAD
    const head = run(["rev-parse", "HEAD"], projectDir);
    const headSha = head.status === 0 ? head.stdout.trim() : "";
    if (!headSha) return { ok: false, reason: "could not resolve HEAD" };
    const upd = run(["update-ref", ref, headSha], projectDir);
    if (upd.status !== 0) return { ok: false, reason: `update-ref failed: ${upd.stdout}` };
    return { ok: true, ref, reason: "clean tree — snapshotted HEAD" };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}
