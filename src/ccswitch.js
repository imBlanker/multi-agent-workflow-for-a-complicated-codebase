// @ts-check
// Read-only access to the cc-switch SQLite database.
//
// cc-switch stores, per "app_type" (claude / codex / gemini / opencode ...):
//   - providers: which provider is `is_current`, its cost_multiplier, provider_type
//   - model_pricing: per-model per-million-token USD prices
//   - proxy_request_logs: actual request spend + timestamps (for cost-rate)
//   - settings: misc key/value
//
// We read it with the built-in `node:sqlite` (Node >=22.5, no native deps).
// If that is unavailable we fall back to the `sqlite3` CLI in JSON mode.
// All access is read-only.
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { exists, round } from "./util.js";

// Resolve the optional node:sqlite binding once at module load (top-level await
// is allowed in ESM). If absent, we use the sqlite3 CLI.
let NODE_SQLITE = null;
try { NODE_SQLITE = await import("node:sqlite"); } catch { NODE_SQLITE = null; }

/** @returns {string|null} path to the cc-switch db, or null if not found */
export function findDb() {
  const candidates = [
    process.env.CC_SWITCH_DB,
    path.join(os.homedir(), ".cc-switch", "cc-switch.db"),
    path.join(os.homedir(), ".config", "cc-switch", "cc-switch.db"),
  ];
  for (const c of candidates) {
    if (c && exists(c)) return c;
  }
  return null;
}

/**
 * @typedef {{ all: (sql: string, ...params: any[]) => any[], impl: string, close: () => void }} Reader
 */

/**
 * Open a read-only sqlite reader.
 * @param {string} dbPath
 * @returns {Reader}
 */
function makeReader(dbPath) {
  if (NODE_SQLITE?.DatabaseSync) {
    try {
      const db = new NODE_SQLITE.DatabaseSync(dbPath, { readOnly: true });
      return {
        impl: "node:sqlite",
        all(sql, ...params) {
          try { return db.prepare(sql).all(...params); } catch { return []; }
        },
        close() { try { db.close(); } catch {} },
      };
    } catch { /* fall through to CLI */ }
  }
  return {
    impl: "sqlite3-cli",
    all(sql) {
      try {
        const out = execFileSync("sqlite3", ["-json", "-readonly", dbPath, sql], {
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        });
        return out.trim() ? JSON.parse(out) : [];
      } catch { return []; }
    },
    close() {},
  };
}

/** @param {any} v @returns {number} */
function num(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** @param {string} s */
function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Read everything MAW needs from cc-switch in one shot.
 * @param {object} [opts]
 * @param {string} [opts.dbPath]
 */
export function readCcSwitch(opts = {}) {
  const dbPath = opts.dbPath ?? findDb();
  if (!dbPath) {
    return {
      dbPath: "", impl: "none", appTypes: [], currentProviders: {},
      allProviders: [], modelPricing: {}, settings: {},
    };
  }
  const r = makeReader(dbPath);
  const allProviders = r.all(
    "SELECT id, app_type, name, is_current, provider_type, cost_multiplier, limit_daily_usd, limit_monthly_usd, website_url, category, sort_index FROM providers ORDER BY app_type, is_current DESC, sort_index"
  );
  const appTypes = [...new Set(allProviders.map((p) => p.app_type))];
  const currentProviders = {};
  for (const p of allProviders) if (p.is_current) currentProviders[p.app_type] = p;

  for (const at of Object.keys(currentProviders)) {
    const row = r.all(
      `SELECT settings_config FROM providers WHERE app_type=${sqlStr(at)} AND is_current=1 LIMIT 1`
    )[0];
    if (row?.settings_config) {
      try { currentProviders[at].settings_config = JSON.parse(row.settings_config); }
      catch { currentProviders[at].settings_config = { raw: String(row.settings_config) }; }
    }
  }

  const pricingRows = r.all(
    "SELECT model_id, display_name, input_cost_per_million, output_cost_per_million, cache_read_cost_per_million, cache_creation_cost_per_million FROM model_pricing"
  );
  const modelPricing = {};
  for (const p of pricingRows) {
    modelPricing[p.model_id] = {
      model_id: p.model_id,
      display_name: p.display_name,
      input_per_m: num(p.input_cost_per_million),
      output_per_m: num(p.output_cost_per_million),
      cache_read_per_m: num(p.cache_read_cost_per_million),
      cache_creation_per_m: num(p.cache_creation_cost_per_million),
      source: "cc-switch",
    };
  }

  const settingsRows = r.all("SELECT key, value FROM settings");
  const settings = {};
  for (const s of settingsRows) settings[s.key] = s.value;

  r.close();
  return { dbPath, impl: r.impl, appTypes, currentProviders, allProviders, modelPricing, settings };
}

/**
 * Resolve the "current model" for an app_type from the current provider's
 * settings_config env block (Claude Code style) or top-level config (Codex).
 * @param {Record<string, any>} currentProviders
 * @param {string} appType
 */
export function resolveModel(currentProviders, appType) {
  const p = currentProviders[appType];
  if (!p) return { model: null, env: {}, raw: null };
  const sc = p.settings_config ?? {};
  const env = {};
  if (sc.env && typeof sc.env === "object") {
    for (const [k, v] of Object.entries(sc.env)) env[k] = String(v);
  }
  let model = env.ANTHROPIC_MODEL || env.CLAUDE_MODEL || sc.model || null;
  if (appType === "codex") model = sc.model || env.CODEX_MODEL || model;
  if (appType === "gemini") model = env.GEMINI_MODEL || sc.model || model;
  return { model, env, raw: sc };
}

/**
 * Sum actual spend from proxy_request_logs over the last `windowSeconds` and
 * divide by (windowSeconds/60) to get USD/min. This is the *real* inference
 * cost rate (not a token estimate), per the spec.
 * @param {object} opts
 * @param {string} [opts.dbPath]
 * @param {number} [opts.windowSeconds] default 3600 (1h)
 * @param {string} [opts.appType]
 * @param {string} [opts.sessionId]
 */
export function costRate(opts = {}) {
  const dbPath = opts.dbPath ?? findDb();
  const win = opts.windowSeconds ?? 3600;
  if (!dbPath) return { ratePerMin: 0, totalUsd: 0, requestCount: 0, windowSeconds: win, impl: "none" };
  const r = makeReader(dbPath);
  const since = Math.floor(Date.now() / 1000) - win;
  let where = "created_at >= " + since;
  if (opts.appType) where += " AND app_type=" + sqlStr(opts.appType);
  if (opts.sessionId) where += " AND session_id=" + sqlStr(opts.sessionId);
  const rows = r.all(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(total_cost_usd AS REAL)),0) as total FROM proxy_request_logs WHERE ${where}`
  );
  const row = rows[0] || { cnt: 0, total: 0 };
  r.close();
  const totalUsd = num(row.total);
  const minutes = Math.max(win / 60, 1 / 60);
  return {
    ratePerMin: round(totalUsd / minutes, 4),
    totalUsd: round(totalUsd, 6),
    requestCount: num(row.cnt),
    windowSeconds: win,
    impl: r.impl,
  };
}

/**
 * Per-session (== per-agent run) spend breakdown.
 * @param {object} [opts]
 * @param {string} [opts.dbPath]
 * @param {number} [opts.windowSeconds]
 */
export function perSessionRate(opts = {}) {
  const dbPath = opts.dbPath ?? findDb();
  const win = opts.windowSeconds ?? 3600;
  if (!dbPath) return { sessions: [], windowSeconds: win };
  const r = makeReader(dbPath);
  const since = Math.floor(Date.now() / 1000) - win;
  const rows = r.all(
    `SELECT session_id, app_type, model, COUNT(*) as cnt, COALESCE(SUM(CAST(total_cost_usd AS REAL)),0) as total, MAX(created_at) as last FROM proxy_request_logs WHERE created_at >= ${since} AND session_id IS NOT NULL GROUP BY session_id, app_type ORDER BY total DESC LIMIT 200`
  );
  r.close();
  const minutes = Math.max(win / 60, 1 / 60);
  const sessions = rows.map((row) => ({
    sessionId: row.session_id, appType: row.app_type, model: row.model,
    totalUsd: round(num(row.total), 6),
    ratePerMin: round(num(row.total) / minutes, 4),
    requestCount: num(row.cnt), lastAt: num(row.last),
  }));
  return { sessions, windowSeconds: win };
}
