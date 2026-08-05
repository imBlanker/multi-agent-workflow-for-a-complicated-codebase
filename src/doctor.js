// @ts-check
// `maw doctor` — environment + capability report.
import { execFileSync } from "node:child_process";
import { readJson } from "./util.js";
import { readCcSwitch, findDb } from "./ccswitch.js";
import { detectHost, hostCapabilities } from "./host.js";
import { status as codexStatus } from "./codex.js";
import path from "node:path";
import os from "node:os";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** @returns {{ ok: boolean, checks: { name: string, status: "ok"|"warn"|"fail", detail: string }[], summary: string }} */
export function doctor() {
  const checks = [];

  // node version
  const nv = process.versions.node;
  checks.push({ name: "Node.js", status: Number(nv.split(".")[0]) >= 20 ? "ok" : "warn", detail: `v${nv}` });

  // git
  try {
    const git = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
    checks.push({ name: "git", status: "ok", detail: git });
  } catch {
    checks.push({ name: "git", status: "warn", detail: "not found" });
  }

  // host
  const host = detectHost();
  checks.push({ name: "Host agent software", status: host.app === "unknown" ? "warn" : "ok", detail: `${host.app} at ${host.homeDir || "(none)"}; caps: ${hostCapabilities(host).join(", ") || "none"}` });

  // cc-switch
  const db = findDb();
  if (!db) {
    checks.push({ name: "cc-switch database", status: "warn", detail: "not found; pricing & cost-rate will be unavailable" });
  } else {
    const cc = readCcSwitch({ dbPath: db });
    const cur = Object.keys(cc.currentProviders);
    checks.push({ name: "cc-switch database", status: "ok", detail: `${db} (impl ${cc.impl}); current providers: ${cur.join(", ") || "none"}` });
    checks.push({ name: "cc-switch model pricing", status: "ok", detail: `${Object.keys(cc.modelPricing).length} models priced` });
  }

  // codex
  const cs = codexStatus();
  checks.push({ name: "Codex CLI", status: cs.binary ? "ok" : "warn", detail: cs.binary || "not found" });
  checks.push({ name: "codex-plugin-cc", status: cs.companion ? "ok" : "warn", detail: cs.companion || cs.reason });

  // package
  const pkg = readJson(path.join(PKG_ROOT, "package.json"), { version: "?" });
  checks.push({ name: "MAW package", status: "ok", detail: `v${pkg.version}` });

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const ok = fails === 0;
  const summary = `${checks.length} checks: ${checks.length - fails - warns} ok, ${warns} warn, ${fails} fail`;
  return { ok, checks, summary };
}
