// @ts-check
// Build a minimal cc-switch-like sqlite DB for tests. Mirrors only the tables
// MAW reads: providers, model_pricing, settings, proxy_request_logs.
// Used by tests/*.test.js so tests never touch the user's real cc-switch.db.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let NODE_SQLITE = null;
try { NODE_SQLITE = await import("node:sqlite"); } catch { NODE_SQLITE = null; }

/**
 * @param {string} dbPath
 * @param {{ withLogs?: boolean, multiplier?: number }} [opts]
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
  ];

  const settingsConfig = JSON.stringify({
    env: {
      ANTHROPIC_MODEL: "claude-opus-5",
      ANTHROPIC_AUTH_TOKEN: "secret-redacted",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8081",
    },
  });
  const codexConfig = JSON.stringify({ model: "gpt-5.2-codex", config: { personality: "pragmatic" }, auth: "secret-redacted" });

  const rows = [
    { table: "providers", vals: ["p1", "claude", "Test Claude", settingsConfig, null, null, 1, 0, null, null, null, "{}", 1, 0, String(opts.multiplier ?? 1), null, null, null] },
    { table: "providers", vals: ["p2", "codex", "Test Codex", codexConfig, null, null, 1, 0, null, null, null, "{}", 1, 0, "1", null, null, null] },
    { table: "providers", vals: ["p3", "gemini", "Test Gemini", JSON.stringify({ model: "gemini-3-pro" }), null, null, 1, 0, null, null, null, "{}", 1, 0, "1", null, null, null] },
  ];

  if (NODE_SQLITE?.DatabaseSync) {
    const db = new NODE_SQLITE.DatabaseSync(dbPath);
    for (const s of sql) db.exec(s);
    const insProv = db.prepare(`INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier, limit_daily_usd, limit_monthly_usd, provider_type) VALUES (${Array(18).fill("?").join(",")})`);
    for (const r of rows) if (r.table === "providers") insProv.run(...r.vals);
    const insP = db.prepare(`INSERT INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million, cache_read_cost_per_million, cache_creation_cost_per_million) VALUES (${Array(6).fill("?").join(",")})`);
    insP.run("claude-opus-5", "Claude Opus 5", "5", "25", "0.50", "6.25");
    insP.run("claude-sonnet-5", "Claude Sonnet 5", "3", "15", "0.30", "3.75");
    insP.run("gpt-5.2-codex", "GPT-5.2 Codex", "1.75", "14", "0.175", "0");
    const insS = db.prepare("INSERT INTO settings (key, value) VALUES (?,?)");
    insS.run("theme", "dark");
    if (opts.withLogs) {
      const insLog = db.prepare("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES (?,?,?,?,?,?,?,?)");
      const now = Math.floor(Date.now() / 1000);
      // 3 requests in the last minute, total $2 → rate $2/min (over the $1/min per-agent default, under $10/min total)
      insLog.run("r1", "p1", "claude", "claude-opus-5", "0.50", 200, "sess-A", now - 40);
      insLog.run("r2", "p1", "claude", "claude-opus-5", "0.50", 200, "sess-A", now - 30);
      insLog.run("r3", "p1", "claude", "claude-opus-5", "0.50", 200, "sess-A", now - 10);
    }
    db.close();
    return;
  }

  // Fallback: sqlite3 CLI
  const all = [...sql,
    `INSERT INTO providers VALUES ('p1','claude','Test Claude','${settingsConfig.replace(/'/g, "''")}',NULL,NULL,1,0,NULL,NULL,NULL,'{}',1,0,'${opts.multiplier ?? 1}',NULL,NULL,NULL)`,
    `INSERT INTO providers VALUES ('p2','codex','Test Codex','${codexConfig.replace(/'/g, "''")}',NULL,NULL,1,0,NULL,NULL,NULL,'{}',1,0,'1',NULL,NULL,NULL)`,
    `INSERT INTO providers VALUES ('p3','gemini','Test Gemini','${JSON.stringify({ model: "gemini-3-pro" }).replace(/'/g, "''")}',NULL,NULL,1,0,NULL,NULL,NULL,'{}',1,0,'1',NULL,NULL,NULL)`,
    `INSERT INTO model_pricing VALUES ('claude-opus-5','Claude Opus 5','5','25','0.50','6.25')`,
    `INSERT INTO model_pricing VALUES ('claude-sonnet-5','Claude Sonnet 5','3','15','0.30','3.75')`,
    `INSERT INTO model_pricing VALUES ('gpt-5.2-codex','GPT-5.2 Codex','1.75','14','0.175','0')`,
    `INSERT INTO settings VALUES ('theme','dark')`,
  ];
  if (opts.withLogs) {
    const now = Math.floor(Date.now() / 1000);
    all.push(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES ('r1','p1','claude','claude-opus-5','0.50',200,'sess-A',${now - 40})`);
    all.push(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES ('r2','p1','claude','claude-opus-5','0.50',200,'sess-A',${now - 30})`);
    all.push(`INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, total_cost_usd, status_code, session_id, created_at) VALUES ('r3','p1','claude','claude-opus-5','0.50',200,'sess-A',${now - 10})`);
  }
  const dump = all.map((s) => s + ";").join("\n");
  execFileSync("sqlite3", [dbPath], { input: dump, encoding: "utf8" });
}
