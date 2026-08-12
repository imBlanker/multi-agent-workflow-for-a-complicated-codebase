// GitHub Actions runner for the trellis update tracker.
// Runs inside the `trellis-update-tracker` workflow (ubuntu-latest, Node 22):
//   - imports the testable logic from src/trellistracker.js
//   - queries npm + GitHub for the @mindfoldhq/trellis upstream
//   - opens deduplicated issues via the GitHub REST API (GH_TOKEN)
//   - persists the tracker state (committed back by the workflow)
// Always exits 0 on upstream outages (the ONLY exception: trellis deleted its
// repo — then we notice + pause, never fail).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkTrellisUpstream, isTrackerIssueOpen, GITHUB_REPO_URL } from "../../src/trellistracker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const statePath = path.join(root, ".github", "trellis-tracker", "state.json");
const repo = process.env.GITHUB_REPOSITORY || "imBlanker/multi-agent-workflow-for-a-complicated-codebase";
const token = process.env.GH_TOKEN || "";
const apiBase = `https://api.github.com/repos/${repo}`;

/** GitHub REST fetch with the workflow token (avoids rate limits). */
async function gh(url, opts = {}) {
  const headers = { "User-Agent": "maw-trellis-tracker", Accept: "application/vnd.github+json", ...(opts.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...opts, headers });
}

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const result = await checkTrellisUpstream({
  state,
  fetchImpl: async (url, opts) => (url === GITHUB_REPO_URL ? gh(url, opts) : fetch(url, opts)),
});
fs.writeFileSync(statePath, JSON.stringify(result.state, null, 2) + "\n");
console.log(`trellis-tracker: action=${result.action}${result.note ? ` (${result.note})` : ""}`);

if (result.issue) {
  const issues = await (await gh(`${apiBase}/issues?state=open&per_page=100`)).json();
  if (isTrackerIssueOpen(issues, result.issue.title)) {
    console.log(`trellis-tracker: issue already open, skipping (${result.issue.title})`);
  } else {
    const created = await gh(`${apiBase}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: result.issue.title, body: result.issue.body }),
    });
    if (!created.ok) {
      console.error(`trellis-tracker: failed to open issue (HTTP ${created.status})`);
      process.exitCode = 1;
    } else {
      const j = await created.json();
      console.log(`trellis-tracker: opened issue #${j.number} — ${j.title}`);
    }
  }
}

process.exit(result.exitCode ?? 0);
