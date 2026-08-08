// @ts-check
// Pi Agent provider/model reader. cc-switch does NOT manage pi (no `pi`
// app_type; pi is not routed via its proxy). Pi keeps its own provider + model
// + pricing config in ~/.pi/agent/. This module reads those files and produces
// a cc-switch-shaped object so modelcap.js / configgen.js work unchanged.
//
// SECURITY: auth.json keys and models.json `apiKey` fields are NEVER returned.
// We only report auth/config presence so downstream can show "configured".
import path from "node:path";
import { exists, readJson, home } from "./util.js";

/**
 * @returns {string} ~/.pi/agent (or $PI_AGENT_DIR) when present, else ""
 */
export function findPiAgentDir() {
  const dir = process.env.PI_AGENT_DIR || path.join(home(), ".pi", "agent");
  return exists(dir) ? dir : "";
}

/**
 * Read raw pi config files. Does NOT exfiltrate keys: auth.json is presence-only
 * and models.json apiKey fields stay inside `models` (callers must not copy them
 * across — readPiAsCc deliberately omits them).
 * @param {string} [piDir]
 * @returns {{
 *   settings: any,
 *   models: any,
 *   modelsStore: any,
 *   mcp: any,
 *   authPresent: boolean,
 *   impl: "pi-files"
 * } | null}
 */
export function readPiConfig(piDir) {
  const dir = piDir || findPiAgentDir();
  if (!dir || !exists(dir)) return null;
  return {
    settings: readJson(path.join(dir, "settings.json"), {}),
    models: readJson(path.join(dir, "models.json"), { providers: {} }),
    modelsStore: readJson(path.join(dir, "models-store.json"), {}),
    mcp: readJson(path.join(dir, "mcp.json"), { mcpServers: {} }),
    authPresent: exists(path.join(dir, "auth.json")),
    impl: "pi-files",
  };
}

/**
 * Cost-rate note shown wherever a pi host has no cc-switch spend telemetry.
 * @returns {string}
 */
export function piCostRateNote() {
  return "pi not routed via cc-switch proxy; spend not measured — concurrency-only enforcement";
}

/**
 * Map pi config into the cc-switch-shaped object consumed by modelcap/configgen.
 *
 * Provider rows carry app_type:"pi"; settings_config holds { model, _piModels }
 * (the full model id list for that provider) so `providerModels(sc, "pi")`
 * enumerates every model. Pricing comes from models.json `cost` fields
 * (per-M-token USD, same scale as cc-switch model_pricing). cc-switch pricing
 * is merged in when passed via opts.ccSwitch so shared model ids (gpt-5.5,
 * claude-*) keep their cc-switch entries. apiKey bytes are NEVER copied across.
 *
 * @param {object} [opts]
 * @param {string} [opts.piDir]
 * @param {{ modelPricing?: Record<string, any> }} [opts.ccSwitch] optional cc-switch data for pricing cross-ref
 * @returns {any | null}
 */
export function readPiAsCc(opts = {}) {
  const cfg = readPiConfig(opts.piDir);
  if (!cfg) return null;
  const settings = cfg.settings || {};
  const providersMap = (cfg.models && cfg.models.providers) || {};
  const defaultProvider = settings.defaultProvider || "";
  const defaultModel = settings.defaultModel || "";

  /** @type {any[]} */
  const allProviders = [];
  /** @type {Record<string, any>} */
  const modelPricing = { ...(opts.ccSwitch?.modelPricing || {}) };
  /** @type {Record<string, any>} */
  const currentProviders = {};

  for (const [name, prov] of Object.entries(providersMap)) {
    const models = Array.isArray(prov?.models) ? prov.models : [];
    const ids = models.map((m) => m?.id).filter(Boolean);
    const isCurrent = name === defaultProvider;
    const row = {
      id: name,
      name,
      app_type: "pi",
      is_current: isCurrent ? 1 : 0,
      provider_type: "pi",
      cost_multiplier: 1,
      // settings_config mirrors the cc-switch shape; _piModels is the
      // pi-specific model list consumed by providerModels(sc, "pi").
      // NO apiKey is copied across (presence-only telemetry below).
      settings_config: { model: isCurrent ? defaultModel : (ids[0] || ""), _piModels: ids },
    };
    allProviders.push(row);
    if (isCurrent) currentProviders.pi = row;
    // pricing: pi models.json cost is per-M-token USD, same scale as cc-switch
    for (const m of models) {
      if (!m?.id || !m?.cost) continue;
      modelPricing[m.id] = {
        input_per_m: Number(m.cost.input ?? 0),
        output_per_m: Number(m.cost.output ?? 0),
        source: "pi-models.json",
        estimated: false,
      };
    }
  }

  if (!currentProviders.pi && allProviders.length) {
    // defaultProvider not found among providers — fall back to the first one
    const fb = { ...allProviders[0], is_current: 1 };
    currentProviders.pi = fb;
    allProviders[0] = fb;
  }

  return {
    impl: "pi-files",
    dbPath: "", // signals "not cc-switch" to cost-rate paths
    settings,
    currentProviders,
    allProviders,
    modelPricing,
    // presence-only telemetry (no key bytes)
    authPresent: cfg.authPresent,
    mcpServers: Object.keys((cfg.mcp && cfg.mcp.mcpServers) || {}),
    packages: Array.isArray(settings.packages) ? settings.packages : [],
    costNote: piCostRateNote(),
  };
}
