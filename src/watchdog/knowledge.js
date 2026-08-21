// @ts-check
// Watchdog rescue knowledge base (PRD R7): problem signature fingerprints +
// case files under <workspace>/knowledge/. Hit routing: prior SUCCESS →
// inject precedent (fast path, still must be verified); prior FAILURE →
// skip that fix + inject alternatives; novel+solved → write back.
//
// Signature = sha256 of (host app + error class + key message tokens), where
// tokens are normalized: lowercase, alnum runs >= 3 chars, volatile parts
// (numbers, paths, uuids) stripped, deduped + sorted. Deterministic across
// projects and runs; insensitive to exact counts/paths in the message.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exists, readText, writeText, ensureDir } from "../util.js";

const CASE_HEAD_RE = /^<!-- mawf-case: ([0-9a-f]+) -->$/m;

/**
 * Normalize a symptom text into stable key tokens.
 * @param {string} text
 * @returns {string[]}
 */
export function keyTokens(text) {
  return [
    ...new Set(
      String(text ?? "")
        .toLowerCase()
        .replace(/(?:\/[\w.\-]+)+/g, " ")   // paths
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, " ") // uuids
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .map((t) => t.replace(/^[0-9]+|[0-9]+$/g, "")) // leading/trailing digits
        .filter((t) => t.length >= 3 && !/^[0-9]+$/.test(t))
    ),
  ].sort();
}

/**
 * Fingerprint a blocked finding.
 * @param {{ host: string, finding?: { signal?: string, reason?: string, evidence?: string } | null }} args
 * @returns {string} sha256 hex (first 16 chars)
 */
export function signature(args) {
  const tokens = keyTokens(`${args.finding?.reason ?? ""} ${args.finding?.evidence ?? ""}`);
  const material = JSON.stringify([String(args.host ?? ""), String(args.finding?.signal ?? ""), tokens]);
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/**
 * Write (or overwrite) a case file for a signature.
 * @param {string} knowledgeDir
 * @param {{ sig: string, host: string, symptom: string, fix: string, outcome: "success"|"failed", notes?: string }} c
 */
export function writeCase(knowledgeDir, c) {
  ensureDir(knowledgeDir);
  const body = [
    `<!-- mawf-case: ${c.sig} -->`,
    `# rescue case ${c.sig}`,
    ``,
    `- host: ${c.host}`,
    `- outcome: ${c.outcome}`,
    `- symptom: ${c.symptom}`,
    `- fix: ${c.fix}`,
    c.notes ? `- notes: ${String(c.notes).slice(0, 500).replace(/\n+/g, " ")}` : "",
    `- updatedAt: ${new Date().toISOString()}`,
    ``,
  ].filter((l) => l !== "").join("\n");
  writeText(path.join(knowledgeDir, `${c.sig}.md`), body);
  return path.join(knowledgeDir, `${c.sig}.md`);
}

/**
 * Find the case(s) for a signature. Returns routing info:
 *  - best: latest SUCCESS case (inject as precedent) or null
 *  - failedFixes: fixes that FAILED before (skip them)
 * @param {string} knowledgeDir
 * @param {string} sig
 * @returns {{ best: { fix: string, symptom: string, file: string } | null, failedFixes: string[], any: boolean }}
 */
export function findCase(knowledgeDir, sig) {
  const file = path.join(knowledgeDir, `${sig}.md`);
  if (!exists(file)) return { best: null, failedFixes: [], any: false };
  // multiple attempts are appended as sections separated by a case head line
  const text = readText(file);
  /** @type {{ outcome: string, fix: string, symptom: string }[]} */
  const cases = [];
  const chunks = text.split(/(?=^<!-- mawf-case: )/m);
  for (const chunk of chunks) {
    const outcome = chunk.match(/^- outcome: (success|failed)$/m)?.[1];
    if (!outcome) continue;
    cases.push({
      outcome,
      fix: chunk.match(/^- fix: (.*)$/m)?.[1] ?? "",
      symptom: chunk.match(/^- symptom: (.*)$/m)?.[1] ?? "",
    });
  }
  const successes = cases.filter((c) => c.outcome === "success");
  const best = successes.length ? { ...successes[successes.length - 1], file } : null;
  const failedFixes = [...new Set(cases.filter((c) => c.outcome === "failed").map((c) => c.fix).filter(Boolean))];
  return { best, failedFixes, any: cases.length > 0 };
}

/**
 * Append an attempt to a case file (preserves history for failed-fix skipping).
 * @param {string} knowledgeDir
 * @param {{ sig: string, host: string, symptom: string, fix: string, outcome: "success"|"failed", notes?: string }} c
 */
export function appendCase(knowledgeDir, c) {
  ensureDir(knowledgeDir);
  const file = path.join(knowledgeDir, `${c.sig}.md`);
  if (!exists(file)) return writeCase(knowledgeDir, c);
  const prev = readText(file);
  const attempt = [
    `<!-- mawf-case: ${c.sig} -->`,
    `## attempt ${new Date().toISOString()}`,
    `- host: ${c.host}`,
    `- outcome: ${c.outcome}`,
    `- symptom: ${c.symptom}`,
    `- fix: ${c.fix}`,
    c.notes ? `- notes: ${String(c.notes).slice(0, 500).replace(/\n+/g, " ")}` : "",
    ``,
  ].filter((l) => l !== "").join("\n");
  writeText(file, prev.replace(/\n*$/, "\n") + attempt);
  return file;
}

/**
 * Build the precedent line injected into a Phase A prompt (null when no case).
 * @param {{ best: any, failedFixes: string[] }} hit
 * @returns {string | null}
 */
export function precedentText(hit) {
  if (!hit.any) return null;
  /** @type {string[]} */
  const parts = [];
  if (hit.best) parts.push(`Previously fixed by: ${hit.best.fix}`);
  if (hit.failedFixes.length) parts.push(`Fixes that FAILED before (do NOT retry as-is): ${hit.failedFixes.join("; ")}`);
  return parts.length ? parts.join(". ") : null;
}
