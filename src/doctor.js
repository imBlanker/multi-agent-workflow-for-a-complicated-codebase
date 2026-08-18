// @ts-check
// `maw doctor` — environment + capability + policy report.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { exists, readJson } from "./util.js";
import { readCcSwitch, findDb, readRouting, routingPolicy } from "./ccswitch.js";
import { detectHost, hostCapabilities } from "./host.js";
import { status as codexStatus } from "./codex.js";
import { detectTrellis } from "./trellis.js";
import { readDshConfig, readDshAsCc, readCredentialKeys, dshDefaultModel, dshCostRateNote, readCcPricingJson } from "./dshprovider.js";
import path from "node:path";
import os from "node:os";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SUPPORTED = ["claude-code", "codex", "pi", "dsh"]; // supported host agents (pi/dsh per MAW support-surface policy)

/** cc-switch synced model-pricing.json + its lastSyncAt, or {error}. */
function pricingSyncInfo() {
  try {
    const doc = readJson(path.join(os.homedir(), ".cc-switch", "model-pricing.json"), null);
    if (!doc || !Array.isArray(doc.models)) return { map: {}, syncAt: null, error: "unparseable" };
    return { map: readCcPricingJson(), syncAt: doc.modelsDevSync?.lastSyncAt ?? null, error: null };
  } catch {
    return { map: {}, syncAt: null, error: "unavailable" };
  }
}

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

  // host (claude-code + codex only are supported)
  const host = detectHost();
  const supported = SUPPORTED.includes(host.app);
  checks.push({ name: "Host agent software", status: host.app === "unknown" ? "warn" : (supported ? "ok" : "warn"), detail: `${host.app} at ${host.homeDir || "(none)"}; caps: ${hostCapabilities(host).join(", ") || "none"}${supported ? "" : " — only Claude Code, Codex, Pi and DeepSeek Harness (dsh) are supported"}` });

  // cc-switch (read-only)
  const db = findDb();
  if (!db) {
    checks.push({ name: "cc-switch database", status: "warn", detail: "not found; pricing & cost-rate will be unavailable" });
  } else {
    const cc = readCcSwitch({ dbPath: db });
    const cur = Object.keys(cc.currentProviders);
    checks.push({ name: "cc-switch database (read-only)", status: "ok", detail: `${db} (impl ${cc.impl}); current providers: ${cur.join(", ") || "none"}` });
    checks.push({ name: "cc-switch model pricing", status: "ok", detail: `${Object.keys(cc.modelPricing).length} models priced` });

    // routing policy (claude always on+failover; codex on except OAuth)
    try {
      const routing = readRouting({ dbPath: db });
      const pol = routingPolicy(routing);
      const det = pol.violations.length ? `violations: ${pol.violations.map((v) => v.app + "." + v.field + "=" + v.expected).join("; ")}` : "claude local-routing+failover on; codex " + (pol.codexOAuthInUse ? "routing OFF (OAuth)" : "routing ON");
      checks.push({ name: "cc-switch routing policy", status: pol.compliant ? "ok" : "warn", detail: det + (pol.compliant ? "" : " — run `maw routing --fix`") });
    } catch (e) {
      checks.push({ name: "cc-switch routing policy", status: "warn", detail: "could not read proxy_config" });
    }
  }

  // codex
  const cs = codexStatus();
  checks.push({ name: "Codex CLI", status: cs.binary ? "ok" : "warn", detail: cs.binary || "not found" });
  checks.push({ name: "codex-plugin-cc", status: cs.companion ? "ok" : "warn", detail: cs.companion || cs.reason });

  // pi agent — config lives in ~/.pi/agent/ (NOT cc-switch-managed; spend is
  // not measurable, so cost-rate degrades to concurrency-only)
  const piHome = path.join(os.homedir(), ".pi", "agent");
  if (exists(piHome)) {
    const settings = readJson(path.join(piHome, "settings.json"), null);
    const models = readJson(path.join(piHome, "models.json"), null);
    checks.push({ name: "Pi Agent config", status: "ok", detail: `${piHome}; default provider/model: ${settings?.defaultProvider || "?"} / ${settings?.defaultModel || "?"}` });
    checks.push({ name: "Pi models store", status: models ? "ok" : "warn", detail: models ? `${Object.keys(models.providers || {}).length} providers in models.json` : "models.json not found — provider/model view will be empty" });
    checks.push({ name: "Pi spend tracking", status: "warn", detail: "pi is not routed via the cc-switch proxy — cost-rate is concurrency-only; real spend is not measured" });
  } else {
    checks.push({ name: "Pi Agent config", status: "warn", detail: "~/.pi/agent not found (not installed)" });
  }

  // DeepSeek Harness (dsh) — config lives in $DSH_HOME (~/.dsh), NOT
  // cc-switch-managed. Providers come from settings.yaml
  // (llm-pi-ai.providers); prices cross-ref cc-switch's auto-synced
  // model-pricing.json; spend rate is not measurable (no proxy) → cost-rate
  // degrades to concurrency-only.
  if (host.dshHome) {
    const dshHome = host.dshHome;
    let version = "?";
    try { version = execFileSync("dsh", ["--version"], { encoding: "utf8", timeout: 10000 }).trim(); } catch {}
    const cfg = readDshConfig(dshHome);
    const cc = readDshAsCc({ dshHome });
    const provs = cc?.allProviders ?? [];
    const modelIds = provs.flatMap((p) => p.settings_config?._dshModels ?? []);
    checks.push({ name: "DeepSeek Harness (dsh) config", status: "ok", detail: `${dshHome}${version !== "?" ? `; dsh ${version}` : ""}; profiles: ${(fs.readdirSync(path.join(dshHome, "profiles")).join(", ") || "none")}` });
    checks.push({
      name: "dsh providers (settings.yaml)",
      status: provs.length ? "ok" : "warn",
      detail: provs.length
        ? `${provs.length} provider(s): ${provs.map((p) => `${p.id} (${p.settings_config._dshModels.length} models)`).join(", ")}`
        : "no llm-pi-ai.providers configured — open dsh web → Settings → Models",
    });
    const def = dshDefaultModel({ profile: "web" });
    checks.push({ name: "dsh default model", status: "ok", detail: def ? `${def.provider} / ${def.model} (composed agent-default-model)` : (cc?.currentProviders?.dsh ? `${cc.currentProviders.dsh.id} / ${cc.currentProviders.dsh.settings_config.model} (first provider fallback)` : "unknown") });
    const credKeys = readCredentialKeys(dshHome);
    const envSatisfied = provs.filter((p) => p.apiKeyEnv && process.env[p.apiKeyEnv]).map((p) => p.id);
    checks.push({ name: "dsh credentials", status: "ok", detail: `${credKeys.length} key(s) in .credentials.yaml (${credKeys.join(", ") || "none"}); apiKeyEnv satisfied for: ${envSatisfied.join(", ") || "none (keys resolve inside dsh per request)"}` });
    const preset = cfg?.settings?.["agent-presets"]?.default;
    checks.push({ name: "dsh agent preset", status: preset ? "ok" : "warn", detail: preset ? `default: ${preset}` : "no agent-presets.default in settings.yaml (dsh built-in default applies)" });
    const pricing = pricingSyncInfo();
    const matched = modelIds.filter((id) => pricing.map[id]);
    checks.push({ name: "dsh model pricing (cc-switch sync)", status: "ok", detail: pricing.error ? "model-pricing.json unavailable — price gate reports unknown" : `${Object.keys(pricing.map).length} models synced (last sync ${pricing.syncAt ? new Date(pricing.syncAt).toISOString().slice(0, 16) : "?"}); ${matched.length}/${modelIds.length} dsh models priced` });
    checks.push({ name: "dsh spend tracking", status: "warn", detail: dshCostRateNote() });
    checks.push({ name: "dsh MCP servers", status: "ok", detail: "managed by dsh patch layers (dsh-mcp-client), not cc-switch — MAW reports only" });
  } else {
    checks.push({ name: "DeepSeek Harness (dsh) config", status: "warn", detail: "$DSH_HOME (~/.dsh) not found (not installed)" });
  }

  // trellis (the mandatory next-step init)
  try {
    const det = detectTrellis();
    checks.push({ name: "trellis (next-step init)", status: det.via === "npx" ? "warn" : "ok", detail: det.via === "npx" ? "not on PATH; will use `npx --yes @mindfoldhq/trellis@latest`" : `${det.bin}` });
  } catch (e) {
    checks.push({ name: "trellis (next-step init)", status: "warn", detail: "trellis module unavailable" });
  }

  // package
  const pkg = readJson(path.join(PKG_ROOT, "package.json"), { version: "?" });
  checks.push({ name: "MAW package", status: "ok", detail: `v${pkg.version}` });

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const ok = fails === 0;
  const summary = `${checks.length} checks: ${checks.length - fails - warns} ok, ${warns} warn, ${fails} fail`;
  return { ok, checks, summary };
}
