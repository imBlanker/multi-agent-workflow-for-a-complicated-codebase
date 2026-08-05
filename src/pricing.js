// @ts-check
// Model price resolution with a documented fallback chain, per the spec:
//   1. cc-switch built-in model_pricing  (source: "cc-switch")
//   2. cc-switch provider cost_multiplier (applied on top; source: "cc-switch:multiplier")
//   3. a vendored fallback price list     (source: "fallback:estimate", clearly marked)
//   4. unknown -> null, never faked as exact
//
// We never invent a precise price. When the real price is missing we return
// an *estimated* value and tag it `estimated: true` so configs/labels show it
// as an estimate, not a fact.
import { exists, readJson, round } from "./util.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "defaults", "pricing.fallback.json");
let _fallback = null;
function fallback() {
  if (_fallback === null) _fallback = exists(FALLBACK_FILE) ? readJson(FALLBACK_FILE, { models: {} }) : { models: {} };
  return _fallback;
}

/**
 * @typedef {{
 *   model_id: string,
 *   display_name?: string,
 *   input_per_m: number,
 *   output_per_m: number,
 *   cache_read_per_m: number,
 *   cache_creation_per_m: number,
 *   source: string,
 *   estimated: boolean,
 *   multiplier: number,
 *   notes?: string[],
 * }} ResolvedPrice
 */

/**
 * Resolve a price for a model id.
 * @param {string} modelId
 * @param {{ modelPricing?: Record<string, any>, costMultiplier?: number }} [ctx]
 * @returns {ResolvedPrice|null}
 */
export function resolvePrice(modelId, ctx = {}) {
  if (!modelId) return null;
  const m = String(modelId);
  const multiplier = Number(ctx.costMultiplier ?? 1) || 1;
  const cc = ctx.modelPricing?.[m];
  const notes = [];

  // 1 + 2. cc-switch price + multiplier
  if (cc) {
    const input = num(cc.input_per_m) * multiplier;
    const output = num(cc.output_per_m) * multiplier;
    return {
      model_id: m,
      display_name: cc.display_name || m,
      input_per_m: round(input, 4),
      output_per_m: round(output, 4),
      cache_read_per_m: round(num(cc.cache_read_per_m) * multiplier, 4),
      cache_creation_per_m: round(num(cc.cache_creation_per_m) * multiplier, 4),
      source: multiplier !== 1 ? "cc-switch:multiplier" : "cc-switch",
      estimated: false,
      multiplier,
    };
  }

  // 3. fallback estimate (vendored, clearly marked)
  const fb = fallback()?.models?.[m] ?? fallback()?.models?.[m.toLowerCase()];
  if (fb) {
    notes.push("Price not found in cc-switch; using vendored estimate. Verify on Artificial Analysis / OpenRouter.");
    return {
      model_id: m,
      display_name: fb.display_name || m,
      input_per_m: round(num(fb.input_per_m) * multiplier, 4),
      output_per_m: round(num(fb.output_per_m) * multiplier, 4),
      cache_read_per_m: round(num(fb.cache_read_per_m) * multiplier, 4),
      cache_creation_per_m: round(num(fb.cache_creation_per_m) * multiplier, 4),
      source: "fallback:estimate",
      estimated: true,
      multiplier,
      notes,
    };
  }

  // 4. completely unknown -> null (do not fake)
  return null;
}

/**
 * Project a per-minute USD cost for a model at a given assumed throughput.
 * NOTE: this is a *projection* for planning; the authoritative cost rate is
 * the actual spend measured from cc-switch logs (see cost.js).
 * @param {ResolvedPrice|null} price
 * @param {{ inputTokensPerMin?: number, outputTokensPerMin?: number }} [throughput]
 */
export function projectRate(price, throughput = {}) {
  if (!price) return { ratePerMin: 0, estimated: true, source: "unknown" };
  const inp = throughput.inputTokensPerMin ?? 0;
  const out = throughput.outputTokensPerMin ?? 0;
  const rate = (price.input_per_m * inp) / 1e6 + (price.output_per_m * out) / 1e6;
  return {
    ratePerMin: round(rate, 4),
    estimated: price.estimated,
    source: price.source,
    inputTokensPerMin: inp,
    outputTokensPerMin: out,
  };
}

/** @param {any} v @returns {number} */
function num(v) { if (v == null) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; }
