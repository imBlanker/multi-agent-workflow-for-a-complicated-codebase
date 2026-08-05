// @ts-check
// Build a minimal cc-switch-like sqlite DB for tests. Mirrors the tables MAW
// reads AND the ones MAW may write under its hard-guarded policy:
//   - providers, model_pricing, settings, proxy_request_logs  (read-only)
//   - profiles         (read-only except MAW's OWN new project profile)
//   - proxy_config      (read-only except the claude/codex routing carve-out)
// Used by tests/*.test.js so tests never touch the user's real cc-switch.db.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let NODE_SQLITE = null;
try { NODE_SQLITE = await import("node:sqlite"); } catch { NODE_SQLITE = null; }

const PROFILES_SQL = `CREATE TABLE profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL,
  sort_order INTEGER, created_at INTEGER, updated_at INTEGER
)`;
const PROXY_SQL = `CREATE TABLE proxy_config (
  app_type TEXT PRIMARY KEY, proxy_enabled INTEGER NOT NULL DEFAULT 0,
  listen_address TEXT NOT NULL DEFAULT '127.0.0.1', listen_port INTEGER NOT NULL DEFAULT 15721,
  enable_logging INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 0,
  auto_failover_enabled INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
  streaming_first_byte_timeout INTEGER NOT NULL DEFAULT 60, streaming_idle_timeout INTEGER NOT NULL DEFAULT 120,
  non_streaming_timeout INTEGER NOT NULL DEFAULT 600, circuit_failure_threshold INTEGER NOT NULL DEFAULT 4,
  circuit_success_threshold INTEGER NOT NULL DEFAULT 2, circuit_timeout_seconds INTEGER NOT NULL DEFAULT 60,
  circuit_error_rate_threshold REAL NOT NULL DEFAULT 0.6, circuit_min_requests INTEGER NOT NULL DEFAULT 10,
  default_cost_multiplier TEXT NOT NULL DEFAULT '1', pricing_model_source TEXT NOT NULL DEFAULT 'response',
  live_takeover_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
const PH = (n) => Array(n).fill("?").join(",");

/**
 * @param {string} dbPath
 * @param {{ withLogs?: boolean, multiplier?: number, codexOAuth?: boolean }} [opts]
 */
export function makeFixtureDb(dbPath, opts = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const sql = [
    `CREATE TABLE providers (
      id TEXT, app_type TEXT, name TEXT, settings_config TEXT,
      website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER,
      notes TEXT, icon TEXT, icon_color TEXT, meta TEXT DEFAULT '{}',
      is_current INTEGER DEFAULT 0, in_failover_queue INTEGER DEFAULT 0,
      cost_multiplier TEXT DEFAULT '1.0', limit_daily_usd TEXT, limit_monthly_usd TEXT,
      provider_type TEXT, PRIMARY KEY (id, app_type)
    )`,
    `CREATE TABLE model_pricing (
      model_id TEXT PRIMARY KEY, display_name TEXT,
      input_cost_per_million TEXT, output_cost_per_million TEXT,
      cache_read_cost_per_million TEXT DEFAULT '0',
      cache_creation_cost_per_million TEXT DEFAULT '0'
    )`,
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE proxy_request_logs (
      request_id TEXT PRIMARY KEY, provider_id TEXT, app_type TEXT, model TEXT,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0, cache_creation_tokens INTEGER DEFAULT 0,
      input_cost_usd TEXT DEFAULT '0', output_cost_usd TEXT DEFAULT '0',
      cache_read_cost_usd TEXT DEFAULT '0', cache_creation_cost_usd TEXT DEFAULT '0',
      total_cost_usd TEXT DEFAULT '0', latency_ms INTEGER, first_token_ms INTEGER,
      duration_ms INTEGER, status_code INTEGER, error_message TEXT, session_id TEXT,
      provider_type TEXT, is_streaming INTEGER DEFAULT 0, cost_multiplier TEXT DEFAULT '1.0',
      created_at INTEGER, request_model TEXT, data_source TEXT DEFAULT 'proxy',
      pricing_model TEXT, input_token_semantics INTEGER DEFAULT 0
    )`,
    PROFILES_SQL,
    PROXY_SQL,
    `CREATE TABLE usage_daily_rollups (
      date TEXT NOT NULL, app_type TEXT NOT NULL, provider_id TEXT NOT NULL,
      model TEXT NOT NULL, request_model TEXT NOT NULL DEFAULT '', pricing_model TEXT NOT NULL DEFAULT '',
      request_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost_usd TEXT NOT NULL DEFAULT '0', avg_latency_ms INTEGER NOT NULL DEFAULT 0,
      input_token_semantics INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, app_type, provider_id, model)
    )`,
  ];

  const settingsConfig = JSON.stringify({
    env: {
      ANTHROPIC_MODEL: "claude-opus-5",
      ANTHROPIC_AUTH_TOKEN: "secret-redacted",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8081",
    },
  });
  // Codex config: when codexOAuth, use auth_mode:"chatgpt" (OpenAI OAuth login).
  const codexConfig = opts.codexOAuth
    ? JSON.stringify({ model: "gpt-5.2-codex", config: { personality: "pragmatic" }, auth: { auth_mode: "chatgpt", tokens: { id_token: "x", access_token: "y", refresh_token: "z", account_id: "acc-1" } } })
    : JSON.stringify({ model: "gpt-5.2-codex", config: { personality: "pragmatic" }, auth: "secret-redacted" });

  // The two protected "默认" profiles (must NEVER be modified by MAW).
  const claudeDefaultPayload = JSON.stringify({ providers: { claude: "p1", codex: null }, mcp: { claude: [], codex: [] }, skills: { claude: [], codex: [] }, prompts: { claude: null, codex: null } });
  const codexDefaultPayload = JSON.stringify({ providers: { claude: "p1", codex: "p2" }, mcp: { claude: [], codex: [] }, skills: { claude: [], codex: [] }, prompts: { claude: null, codex: null } });

  const rows = [
    { table: "providers", vals: ["p1", "claude", "Test Claude", settingsConfig, null, null, 1, 0, null, null, null, "{}", 1, 0, String(opts.multiplier ?? 1), "10", "50", null] },
    { table: "providers", vals: ["p2", "codex", "Test Codex", codexConfig, null, null, 1, 0, null, null, null, "{}", 1, 0, "1", null, null, null] },
    { table: "providers", vals: ["p3", "gemini", "Test Gemini", JSON.stringify({ model: "gemini-3-pro" }), null, null, 1, 0, null, null, null, "{}", 1, 0, "1", null, null, null] },
  ];

  if (NODE_SQLITE?.DatabaseSync) {
    const db = new NODE_SQLITE.DatabaseSync(dbPath);
    for (const s of sql) db.exec(s);
    const insProv = db.prepare(`INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier, limit_daily_usd, limit_monthly_usd, provider_type) VALUES (${PH(18)})`);
    for (const r of rows) if (r.table === "providers") insProv.run(...r.vals);
    const insP = db.prepare(`INSERT INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million, cache_read_cost_per_million, cache_creation_cost_per_million) VALUES (${PH(6)})`);
    insP.run("claude-opus-5", "Claude Opus 5", "5", "25", "0.50", "6.25");
    insP.run("claude-sonnet-5", "Claude Sonnet 5", "3", "15", "0.30", "3.75");
    insP.run("gpt-5.2-codex", "GPT-5.2 Codex", "1.75", "14", "0.175", "0");
    const insS = db.prepare("INSERT INTO settings (key, value) VALUES (?,?)");
    insS.run("theme", "dark");
    // protected 默认 profiles
    const insProf = db.prepare(`INSERT INTO profiles (id, name, payload, sort_order, created_at, updated_at) VALUES (${PH(6)})`);
    insProf.run("def-claude", "Claude Code 默认", claudeDefaultPayload, 0, 1, 1);
    insProf.run("def-codex", "Codex 默认", codexDefaultPayload, 1, 1, 1);
    // proxy_config: claude OFF + failover OFF (a VIOLATION MAW must detect), codex OFF
    const PROXY_COLS = "app_type, proxy_enabled, listen_address, listen_port, enable_logging, enabled, auto_failover_enabled, max_retries, streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout, circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds, circuit_error_rate_threshold, circuit_min_requests, default_cost_multiplier, pricing_model_source, live_takeover_active, created_at, updated_at";
    const insPc = db.prepare(`INSERT INTO proxy_config (${PROXY_COLS}) VALUES (${PH(21)})`);
    insPc.run("claude", 0, "127.0.0.1", 45721, 1, 0, 0, 6, 90, 180, 600, 8, 3, 90, 0.7, 15, "1", "response", 0, "2026-01-01 00:00:00", "2026-01-01 00:00:00");
    insPc.run("codex", 0, "127.0.0.1", 45721, 1, 0, 0, 6, 90, 180, 600, 4, 2, 60, 0.6, 10, "1", "response", 0, "2026-01-01 00:00:00", "2026-01-01 00:00:00");
    if (opts.withLogs) {
      const insLog = db.prepare(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES (${PH(8)})`);
      const now = Math.floor(Date.now() / 1000);
      // 3 requests in the last minute, total $1.50 → rate $0.75/min over 120s
      insLog.run("r1", "p1", "claude", "claude-opus-5", "0.50", 200, "sess-A", now - 40);
      insLog.run("r2", "p1", "claude", "claude-opus-5", "0.50", 200, "sess-A", now - 30);
      insLog.run("r3", "p1", "claude", "claude-opus-5", "0.50", 200, "sess-A", now - 10);
    }
    // usage_daily_rollups: $2.00 spent TODAY by p1 (→ remaining today $8 of $10; month $48 of $50)
    const today = new Date().toISOString().slice(0, 10);
    const insRoll = db.prepare(`INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, total_cost_usd) VALUES (${PH(5)})`);
    insRoll.run(today, "claude", "p1", "claude-opus-5", "2.00");
    db.close();
    if (opts.codexOAuth) {
      // sibling codex_oauth_auth.json — MAW detects OAuth login from this + auth_mode
      fs.writeFileSync(path.join(path.dirname(dbPath), "codex_oauth_auth.json"), JSON.stringify({
        version: 1,
        accounts: { "acc-1": { account_id: "acc-1", email: "test@example.com", refresh_token: "rt", authenticated_at: 1 } },
        default_account_id: "acc-1",
      }));
    }
    return;
  }

  // Fallback: sqlite3 CLI
  const esc = (s) => String(s).replace(/'/g, "''");
  const all = [...sql,
    `INSERT INTO providers VALUES ('p1','claude','Test Claude','${esc(settingsConfig)}',NULL,NULL,1,0,NULL,NULL,NULL,'{}',1,0,'${opts.multiplier ?? 1}','10','50',NULL)`,
    `INSERT INTO providers VALUES ('p2','codex','Test Codex','${esc(codexConfig)}',NULL,NULL,1,0,NULL,NULL,NULL,'{}',1,0,'1',NULL,NULL,NULL)`,
    `INSERT INTO providers VALUES ('p3','gemini','Test Gemini','${esc(JSON.stringify({ model: "gemini-3-pro" }))}',NULL,NULL,1,0,NULL,NULL,NULL,'{}',1,0,'1',NULL,NULL,NULL)`,
    `INSERT INTO model_pricing VALUES ('claude-opus-5','Claude Opus 5','5','25','0.50','6.25')`,
    `INSERT INTO model_pricing VALUES ('claude-sonnet-5','Claude Sonnet 5','3','15','0.30','3.75')`,
    `INSERT INTO model_pricing VALUES ('gpt-5.2-codex','GPT-5.2 Codex','1.75','14','0.175','0')`,
    `INSERT INTO settings VALUES ('theme','dark')`,
    `INSERT INTO profiles VALUES ('def-claude','Claude Code 默认','${esc(claudeDefaultPayload)}',0,1,1)`,
    `INSERT INTO profiles VALUES ('def-codex','Codex 默认','${esc(codexDefaultPayload)}',1,1,1)`,
    `INSERT INTO proxy_config (app_type,proxy_enabled,listen_address,listen_port,enable_logging,enabled,auto_failover_enabled,max_retries,streaming_first_byte_timeout,streaming_idle_timeout,non_streaming_timeout,circuit_failure_threshold,circuit_success_threshold,circuit_timeout_seconds,circuit_error_rate_threshold,circuit_min_requests,default_cost_multiplier,pricing_model_source,live_takeover_active,created_at,updated_at) VALUES ('claude',0,'127.0.0.1',45721,1,0,0,6,90,180,600,8,3,90,0.7,15,'1','response',0,'2026-01-01 00:00:00','2026-01-01 00:00:00')`,
    `INSERT INTO proxy_config (app_type,proxy_enabled,listen_address,listen_port,enable_logging,enabled,auto_failover_enabled,max_retries,streaming_first_byte_timeout,streaming_idle_timeout,non_streaming_timeout,circuit_failure_threshold,circuit_success_threshold,circuit_timeout_seconds,circuit_error_rate_threshold,circuit_min_requests,default_cost_multiplier,pricing_model_source,live_takeover_active,created_at,updated_at) VALUES ('codex',0,'127.0.0.1',45721,1,0,0,6,90,180,600,4,2,60,0.6,10,'1','response',0,'2026-01-01 00:00:00','2026-01-01 00:00:00')`,
  ];
  if (opts.withLogs) {
    const now = Math.floor(Date.now() / 1000);
    all.push(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES ('r1','p1','claude','claude-opus-5','0.50',200,'sess-A',${now - 40})`);
    all.push(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES ('r2','p1','claude','claude-opus-5','0.50',200,'sess-A',${now - 30})`);
    all.push(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES ('r3','p1','claude','claude-opus-5','0.50',200,'sess-A',${now - 10})`);
  }
  const today = new Date().toISOString().slice(0, 10);
  all.push(`INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, total_cost_usd) VALUES ('${today}','claude','p1','claude-opus-5','2.00')`);
  const dump = all.map((s) => s + ";").join("\n");
  execFileSync("sqlite3", [dbPath], { input: dump, encoding: "utf8" });
  if (opts.codexOAuth) {
    fs.writeFileSync(path.join(path.dirname(dbPath), "codex_oauth_auth.json"), JSON.stringify({
      version: 1, accounts: { "acc-1": { account_id: "acc-1", email: "test@example.com", refresh_token: "rt", authenticated_at: 1 } }, default_account_id: "acc-1",
    }));
  }
}
