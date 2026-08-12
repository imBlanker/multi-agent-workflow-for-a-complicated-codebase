// @ts-check
// Trellis upstream tracker — used by the GitHub Actions workflow
// `.github/workflows/trellis-tracker.yml` (via `.github/scripts/trellis-tracker.mjs`)
// to automatically track updates of `@mindfoldhq/trellis`, the workflow system
// MAW chains after `maw init` (`src/trellis.js`).
//
// Policy (user-mandated 2026-08-12):
//   - run on a schedule (weekly) + manual dispatch;
//   - when a new npm version appears → open an update issue + advance state;
//   - the ONLY exception: trellis deletes its repo (upstream 404). Then we open
//     ONE notice issue, pause tracking (`upstreamOk=false`), and NEVER fail the
//     workflow (exit 0). When the upstream comes back, tracking resumes.
//
// All logic lives here (pure, fetch-injectable) so it is unit-testable with
// node:test; the runner script only wires it to the filesystem + GitHub API.
export const NPM_LATEST_URL = "https://registry.npmjs.org/@mindfoldhq/trellis/latest";
export const GITHUB_REPO_URL = "https://api.github.com/repos/mindfold-ai/trellis";
export const TRACKER_PREFIX = "[trellis-tracker]";

/**
 * One tracking pass. Pure: everything except the two upstream fetches is
 * deterministic; `fetchImpl` is injectable for tests.
 * @param {object} opts
 * @param {{ lastKnownVersion?: string|null, upstreamOk?: boolean, lastCheckedAt?: string|null }} opts.state
 * @param {(url: string, opts?: any) => Promise<{ status: number, json: () => Promise<any> }>} [opts.fetchImpl]
 * @param {string} [opts.npmUrl]
 * @param {string} [opts.repoUrl]
 * @param {string} [opts.nowIso]
 * @returns {Promise<{ state: any, action: "update"|"notice"|"recover"|"noop", note?: string, exitCode: number, issue?: { title: string, body: string } }>}
 */
export async function checkTrellisUpstream(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const base = { lastKnownVersion: null, upstreamOk: true, lastCheckedAt: null, ...opts.state };

  // 1) npm latest version
  let npmStatus = 0, npmVersion = null;
  try {
    const r = await fetchImpl(opts.npmUrl ?? NPM_LATEST_URL, { headers: { Accept: "application/json", "User-Agent": "maw-trellis-tracker" } });
    npmStatus = r.status;
    if (r.status === 200) {
      const d = await r.json();
      npmVersion = d?.version ?? null;
    }
  } catch { npmStatus = 0; }

  // 2) GitHub repo health (repo deleted / renamed / made private → 404)
  let repoStatus = 0, repoInfo = null;
  try {
    const r = await fetchImpl(opts.repoUrl ?? GITHUB_REPO_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "maw-trellis-tracker" } });
    repoStatus = r.status;
    if (r.status === 200) repoInfo = await r.json();
  } catch { repoStatus = 0; }

  const s = { ...base, lastCheckedAt: nowIso };

  // Transient errors (network, 5xx, rate-limit): skip this pass quietly, do
  // not flip `upstreamOk`, never fail the workflow.
  const npmKnown = npmStatus === 200 || npmStatus === 404;
  const repoKnown = repoStatus === 200 || repoStatus === 404;
  if (!npmKnown || !repoKnown) {
    return { state: s, action: "noop", note: `transient upstream error (npm HTTP ${npmStatus}, github HTTP ${repoStatus})`, exitCode: 0 };
  }

  // Upstream GONE (the "trellis 删库" exception): one notice, pause, exit 0.
  const gone = npmStatus === 404 || repoStatus === 404;
  if (gone) {
    if (base.upstreamOk) {
      return {
        state: { ...s, upstreamOk: false },
        action: "notice",
        exitCode: 0,
        issue: {
          title: `${TRACKER_PREFIX} Trellis upstream unavailable (404) — update tracking paused`,
          body: outageBody(npmStatus, repoStatus),
        },
      };
    }
    return { state: s, action: "noop", note: "upstream still unavailable; tracking stays paused", exitCode: 0 };
  }

  // Healthy upstream.
  const recovered = base.upstreamOk === false;
  const s2 = { ...s, upstreamOk: true };
  if (!npmVersion || npmVersion === base.lastKnownVersion) {
    return { state: s2, action: recovered ? "recover" : "noop", note: recovered ? "upstream recovered (no new version)" : "no new version", exitCode: 0 };
  }
  return {
    state: { ...s2, lastKnownVersion: npmVersion },
    action: "update",
    exitCode: 0,
    issue: {
      title: `${TRACKER_PREFIX} Trellis update available: ${base.lastKnownVersion ?? "?"} → ${npmVersion}`,
      body: updateBody(base, npmVersion, repoInfo, recovered),
    },
  };
}

/**
 * True when an open issue with the same tracker title already exists
 * (dedupe for the runner script).
 * @param {{ title: string }[]} openIssues
 * @param {string} title
 */
export function isTrackerIssueOpen(openIssues, title) {
  return (openIssues ?? []).some((i) => String(i.title).startsWith(TRACKER_PREFIX) && i.title === title);
}

/** @param {any} state @param {string} version @param {any} repoInfo @param {boolean} recovered */
function updateBody(state, version, repoInfo, recovered) {
  const lines = [];
  lines.push(`Trellis (\`@mindfoldhq/trellis\`) has a new release.`);
  lines.push("");
  lines.push(`- **New version**: \`${version}\`${state.lastKnownVersion ? ` (previously tracked: \`${state.lastKnownVersion}\`)` : ""}`);
  lines.push(`- **npm**: https://www.npmjs.com/package/@mindfoldhq/trellis`);
  lines.push(`- **GitHub**: https://github.com/mindfold-ai/trellis`);
  if (repoInfo?.pushed_at) lines.push(`- **Last push to upstream**: ${repoInfo.pushed_at}`);
  if (repoInfo?.archived) lines.push(`- **⚠ The upstream repo is ARCHIVED** — consider pinning or migrating.`);
  if (recovered) lines.push(`- **Recovered**: the upstream was previously unavailable (404) and is reachable again.`);
  lines.push("");
  lines.push(`MAW invokes trellis via \`npx --yes @mindfoldhq/trellis@latest\` (src/trellis.js) — nothing to change for MAW to pick it up, but review the changelog for breaking changes before the next \`maw init\`.`);
  lines.push("");
  lines.push(`_Opened automatically by the \`trellis-update-tracker\` workflow (.github/workflows/trellis-tracker.yml). Tracked state: .github/trellis-tracker/state.json._`);
  return lines.join("\n");
}

/** @param {number} npmStatus @param {number} repoStatus */
function outageBody(npmStatus, repoStatus) {
  const lines = [];
  lines.push(`The trellis upstream is no longer reachable — **update tracking is paused** until it comes back.`);
  lines.push("");
  lines.push(`- npm registry (\`@mindfoldhq/trellis/latest\`): HTTP ${npmStatus || "network error"}`);
  lines.push(`- GitHub repo (\`mindfold-ai/trellis\`): HTTP ${repoStatus || "network error"}`);
  lines.push("");
  lines.push(`Possible causes: the repository was deleted or renamed, the npm package was unpublished, or access was restricted.`);
  lines.push(`The tracker keeps running on schedule and automatically resumes when the upstream returns (see \`upstreamOk\` in .github/trellis-tracker/state.json).`);
  lines.push("");
  lines.push(`_Opened automatically by the \`trellis-update-tracker\` workflow._`);
  return lines.join("\n");
}
