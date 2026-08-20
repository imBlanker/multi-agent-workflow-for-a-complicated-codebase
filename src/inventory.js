// @ts-check
// Cross-host agent inventory: scan ALL installed supported hosts
// (claude-code, codex, pi, dsh) + the current project and emit an
// InventoryReport (machine JSON) plus a compact digest (agent-readable).
// This is the machine-wide awareness layer consumed by advise/injection.
//
// Reuse rules (do NOT duplicate parsing):
//   - presence + capabilities: detectHost() from host.js
//   - providers/models: readCcSwitch / readPiAsCc / readDshAsCc + candidatesForAppType
//   - prices: resolvePrice (pricing.js source chain; never fake exact)
//
// Robustness: a missing host is skipped; a throwing per-host scan degrades to
// {app, error}; broken JSON files fall back to empty (readJson fallback).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exists, isFile, readJson, readText, writeJson, writeText, ensureDir } from "./util.js";
import { detectHost, hostCapabilities } from "./host.js";
import { readCcSwitch } from "./ccswitch.js";
import { readPiAsCc } from "./piprovider.js";
import { readDshAsCc } from "./dshprovider.js";
import { candidatesForAppType, classifyModel } from "./modelcap.js";
import { resolvePrice } from "./pricing.js";

/**
 * @typedef {"claude-code"|"codex"|"pi"|"dsh"} HostApp
 * @typedef {{ name: string, path: string, realPath: string, description: string }} SkillEntry
 * @typedef {{ name: string, source: string }} NamedEntry
 * @typedef {{ id: string, provider: string, source: string, isCurrent: boolean, family: string, tags: string[], price: { input_per_m: number, output_per_m: number, source: string, estimated: boolean } | null }} ModelEntry
 * @typedef {{ generatedAt: string, projectDir: string, hosts: any[] }} InventoryReport
 */

const APP_TYPES = { "claude-code": "claude", codex: "codex", pi: "pi", dsh: "dsh" };

/** @returns {string} */
function home() { return os.homedir(); }

/**
 * Scan one skills directory: every child dir containing SKILL.md becomes an
 * entry. Description = YAML frontmatter `description:` if present, else the
 * first non-heading line (≤200 chars), else "".
 * @param {string} dir
 * @returns {SkillEntry[]}
 */
function scanSkillsDir(dir) {
  if (!exists(dir)) return [];
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const skillPath = path.join(dir, e.name);
    const md = path.join(skillPath, "SKILL.md");
    if (!isFile(md)) continue;
    let realPath = skillPath;
    try { realPath = fs.realpathSync(skillPath); } catch {}
    out.push({ name: e.name, path: skillPath, realPath, description: readSkillDescription(md) });
  }
  return out;
}

/**
 * @param {string} md
 * @returns {string}
 */
function readSkillDescription(md) {
  let text = "";
  try { text = readText(md); } catch { return ""; }
  // frontmatter description
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end > 0) {
      const m = text.slice(3, end).match(/^description:\s*"?(.+?)"?\s*$/m);
      if (m) return clip(m[1]);
    }
  }
  // first non-heading, non-empty line outside frontmatter
  const body = text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    return clip(t);
  }
  return "";
}

/** @param {string} s */
function clip(s) { s = String(s).trim(); return s.length > 200 ? s.slice(0, 197) + "…" : s; }

/**
 * List skills across dirs, deduped by resolved real path (symlinks from
 * ~/.cc-switch/skills are linked into several hosts; within ONE host the same
 * real skill must appear once).
 * @param {string[]} dirs
 * @returns {SkillEntry[]}
 */
export function listSkills(dirs) {
  const seen = new Set();
  const out = [];
  for (const d of dirs) {
    for (const s of scanSkillsDir(d)) {
      if (seen.has(s.realPath)) continue;
      seen.add(s.realPath);
      out.push(s);
    }
  }
  return out;
}

/**
 * Read a "mcpServers"-shaped JSON file → NamedEntry[].
 * @param {string} file
 * @param {string} source
 */
function mcpFromJson(file, source) {
  const d = readJson(file, null);
  const map = d && typeof d === "object" ? (d.mcpServers ?? d.servers ?? null) : null;
  if (!map || typeof map !== "object") return [];
  return Object.keys(map).map((name) => ({ name, source }));
}

/**
 * Build model entries for one host from its cc-shaped provider data.
 * @param {any} cc cc-shaped object ({allProviders, modelPricing})
 * @param {string} appType
 * @returns {ModelEntry[]}
 */
function modelsForAppType(cc, appType) {
  if (!cc) return [];
  const pricing = cc.modelPricing || {};
  const seen = new Set();
  const out = [];
  for (const c of candidatesForAppType(cc, appType)) {
    if (!c.model || seen.has(c.model)) continue;
    seen.add(c.model);
    const cls = classifyModel(c.model);
    const tags = Object.entries(cls.caps ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    const price = resolvePrice(c.model, { modelPricing: pricing, costMultiplier: c.costMultiplier });
    out.push({
      id: c.model,
      provider: c.providerName || c.providerId || appType,
      source: appType,
      isCurrent: !!c.isCurrent,
      family: cls.family,
      tags,
      price: price ? { input_per_m: price.input_per_m, output_per_m: price.output_per_m, source: price.source, estimated: !!price.estimated } : null,
    });
  }
  return out;
}

/**
 * Scan ALL installed supported hosts + the project → InventoryReport.
 * All host dirs are injectable (tests NEVER touch the real ~).
 * @param {object} [opts]
 * @param {string} [opts.claudeDir]   default ~/.claude
 * @param {string} [opts.codexDir]    default ~/.codex
 * @param {string} [opts.piDir]       default $PI_AGENT_DIR | ~/.pi/agent
 * @param {string} [opts.dshHome]     default $DSH_HOME | ~/.dsh
 * @param {string} [opts.claudeJson]  default ~/.claude.json (mcpServers)
 * @param {string} [opts.projectDir]  default process.cwd()
 * @param {string} [opts.dbPath]      cc-switch db override
 * @param {string} [opts.dshDumpConfig] dsh --dump-config output override (default "" → skip the real `dsh` exec; hermetic)
 * @returns {InventoryReport}
 */
export function scanInventory(opts = {}) {
  const claudeDir = opts.claudeDir ?? path.join(home(), ".claude");
  const codexDir = opts.codexDir ?? path.join(home(), ".codex");
  const piDir = opts.piDir ?? (process.env.PI_AGENT_DIR || path.join(home(), ".pi", "agent"));
  const dshHome = opts.dshHome ?? (process.env.DSH_HOME || path.join(home(), ".dsh"));
  const claudeJson = opts.claudeJson ?? path.join(home(), ".claude.json");
  const projectDir = path.resolve(opts.projectDir ?? process.cwd());

  const hostInfo = detectHost({ claudeDir, codexDir, piDir, dshHome, projectDir });
  const cc = readCcSwitch(opts.dbPath ? { dbPath: opts.dbPath } : {});
  const basePricing = { ...(cc.modelPricing || {}) };

  /** @type {any[]} */
  const hosts = [];
  const push = (fn) => { try { hosts.push(fn()); } catch (err) { hosts.push({ app: "unknown", error: String(err?.message ?? err) }); } };

  if (exists(claudeDir)) push(() => scanClaude({ claudeDir, claudeJson, projectDir, cc, hostInfo }));
  if (exists(codexDir)) push(() => scanCodex({ codexDir, projectDir, cc, hostInfo }));
  if (exists(piDir)) push(() => scanPi({ piDir, projectDir, cc, hostInfo }));
  if (exists(path.join(dshHome, "settings.yaml")) || exists(path.join(dshHome, "profiles"))) {
    push(() => scanDsh({ dshHome, projectDir, cc, hostInfo, dumpConfig: opts.dshDumpConfig ?? "" }));
  }

  return { generatedAt: new Date().toISOString(), projectDir, hosts };
}

/**
 * @param {{claudeDir:string, claudeJson:string, projectDir:string, cc:any, hostInfo:any}} o
 */
function scanClaude(o) {
  const app = "claude-code";
  const skills = listSkills([path.join(o.claudeDir, "skills")]);
  const plugins = [];
  const installed = readJson(path.join(o.claudeDir, "plugins", "installed_plugins.json"), null);
  const instMap = installed?.plugins && typeof installed.plugins === "object" ? installed.plugins : null;
  if (instMap) for (const k of Object.keys(instMap)) plugins.push({ name: k, source: "installed" });
  const mkts = path.join(o.claudeDir, "plugins", "marketplaces");
  if (exists(mkts)) {
    try {
      for (const e of fs.readdirSync(mkts, { withFileTypes: true })) {
        if (e.isDirectory() && !plugins.some((p) => p.name === e.name)) plugins.push({ name: e.name, source: "marketplace" });
      }
    } catch {}
  }
  const mcps = [...mcpFromJson(o.claudeJson, "user"), ...mcpFromJson(path.join(o.projectDir, ".mcp.json"), "project")];
  const global = isFile(path.join(o.claudeDir, "CLAUDE.md")) ? path.join(o.claudeDir, "CLAUDE.md") : null;
  return {
    app, homeDir: o.claudeDir,
    detected: o.hostInfo.detected.filter((d) => /claude/i.test(d)),
    capabilities: hostCapabilities({ ...o.hostInfo, app: "claude-code" }),
    skills, plugins, mcps,
    prompts: { global, project: projectPromptSurfaces(o.projectDir, ["AGENTS.md", "CLAUDE.md"]) },
    models: modelsForAppType(o.cc, APP_TYPES[app]),
    workflowsHarnesses: projectWorkflows(o.projectDir),
  };
}

/**
 * @param {{codexDir:string, projectDir:string, cc:any, hostInfo:any}} o
 */
function scanCodex(o) {
  const app = "codex";
  const allSkills = listSkills([path.join(o.codexDir, "skills")]);
  const skills = allSkills.filter((s) => !s.name.startsWith("codex-"));
  const plugins = allSkills.filter((s) => s.name.startsWith("codex-")).map((s) => ({ name: s.name, source: "codex-skill" }));
  // MCP: codex keeps servers in config.toml [mcp_servers.<name>] sections;
  // mcp.json is a tolerated fallback shape.
  const mcps = [];
  const toml = path.join(o.codexDir, "config.toml");
  if (isFile(toml)) {
    try {
      const names = [];
      for (const m of readText(toml).matchAll(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)) {
        names.push(m[1] ?? m[2]);
      }
      // drop TOML sub-sections (e.g. [mcp_servers.<srv>.env]) — a dotted
      // child of another captured name is config detail, not a server
      for (const n of names) {
        const dot = n.lastIndexOf(".");
        if (dot > 0 && names.includes(n.slice(0, dot))) continue;
        mcps.push({ name: n, source: "codex-config.toml" });
      }
    } catch {}
  }
  for (const e of mcpFromJson(path.join(o.codexDir, "mcp.json"), "codex-config")) {
    if (!mcps.some((m) => m.name === e.name)) mcps.push(e);
  }
  const global = isFile(path.join(o.codexDir, "AGENTS.md")) ? path.join(o.codexDir, "AGENTS.md") : null;
  return {
    app, homeDir: o.codexDir,
    detected: o.hostInfo.detected.filter((d) => /codex/i.test(d)),
    capabilities: hostCapabilities({ ...o.hostInfo, app: "codex" }),
    skills, plugins, mcps,
    prompts: { global, project: projectPromptSurfaces(o.projectDir, ["AGENTS.md"]) },
    models: modelsForAppType(o.cc, APP_TYPES[app]),
    workflowsHarnesses: projectWorkflows(o.projectDir),
  };
}

/**
 * @param {{piDir:string, projectDir:string, cc:any, hostInfo:any}} o
 */
function scanPi(o) {
  const app = "pi";
  const skills = listSkills([path.join(o.piDir, "skills"), path.join(o.projectDir, ".agents", "skills")]);
  const plugins = [];
  // pi's npm surface is ONE workspace-style package.json whose dependencies
  // are the installed extensions/plugins (verified on a real install).
  const npmPkg = readJson(path.join(o.piDir, "npm", "package.json"), null);
  const deps = npmPkg?.dependencies && typeof npmPkg.dependencies === "object" ? npmPkg.dependencies : null;
  if (deps) for (const k of Object.keys(deps)) plugins.push({ name: k, source: "npm" });
  const extDir = path.join(o.piDir, "extensions");
  if (exists(extDir)) {
    try {
      for (const e of fs.readdirSync(extDir, { withFileTypes: true })) {
        if ((e.isDirectory() || e.isFile()) && !plugins.some((p) => p.name === e.name)) plugins.push({ name: e.name, source: "extension" });
      }
    } catch {}
  }
  // MCP best-effort: npm packages exposing MCP adapters (name contains "mcp")
  const mcps = plugins.filter((p) => /mcp/i.test(p.name)).map((p) => ({ name: p.name, source: "pi-mcp-adapter" }));
  const global = isFile(path.join(o.piDir, "AGENTS.md")) ? path.join(o.piDir, "AGENTS.md") : null;
  const piAsCc = readPiAsCc({ piDir: o.piDir, ccSwitch: { modelPricing: o.cc?.modelPricing } });
  return {
    app, homeDir: o.piDir,
    detected: o.hostInfo.detected.filter((d) => /pi agent/i.test(d)),
    capabilities: hostCapabilities({ ...o.hostInfo, app: "pi" }),
    skills, plugins, mcps,
    prompts: { global, project: projectPromptSurfaces(o.projectDir, ["AGENTS.md"]) },
    models: modelsForAppType(piAsCc, APP_TYPES[app]),
    workflowsHarnesses: projectWorkflows(o.projectDir),
  };
}

/**
 * @param {{dshHome:string, projectDir:string, cc:any, hostInfo:any, dumpConfig:string}} o
 */
function scanDsh(o) {
  const app = "dsh";
  const skills = listSkills([path.join(o.dshHome, "skills")]);
  const plugins = [];
  // MCP report-only: settings.yaml mcp section if present (patch layers)
  const mcps = [];
  try {
    const yaml = readText(path.join(o.dshHome, "settings.yaml"));
    const parsed = parseMcpSection(yaml);
    for (const name of parsed) mcps.push({ name, source: "dsh-patch-layer" });
  } catch {}
  const presets = path.join(o.dshHome, "agent-presets");
  if (exists(presets)) {
    try {
      for (const e of fs.readdirSync(presets, { withFileTypes: true })) {
        if (e.isDirectory()) plugins.push({ name: e.name, source: "agent-preset" });
      }
    } catch {}
  }
  const global = isFile(path.join(o.dshHome, "AGENTS.md")) ? path.join(o.dshHome, "AGENTS.md") : null;
  const dshAsCc = readDshAsCc({ dshHome: o.dshHome, ccSwitch: { modelPricing: o.cc?.modelPricing }, dumpConfig: o.dumpConfig });
  return {
    app, homeDir: o.dshHome,
    detected: o.hostInfo.detected.filter((d) => /dsh|deepseek/i.test(d)),
    capabilities: hostCapabilities({ ...o.hostInfo, app: "dsh" }),
    skills, plugins, mcps,
    prompts: { global, project: projectPromptSurfaces(o.projectDir, ["AGENTS.md"]) },
    models: modelsForAppType(dshAsCc, APP_TYPES[app]),
    workflowsHarnesses: projectWorkflows(o.projectDir),
  };
}

/**
 * Extract top-level mcp server names from a settings.yaml snippet
 * (report-only; dsh MCP is managed by patch layers).
 * @param {string} yaml
 * @returns {string[]}
 */
function parseMcpSection(yaml) {
  const m = yaml.match(/^mcp:\s*\n([\s\S]*?)(?=^\S|\n\S|$)/m);
  if (!m) return [];
  const names = [];
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*$/);
    if (mm) names.push(mm[1]);
  }
  return names;
}

/**
 * Which project prompt surfaces exist (relative names).
 * @param {string} projectDir
 * @param {string[]} relevant
 * @returns {string[]}
 */
function projectPromptSurfaces(projectDir, relevant) {
  return relevant.filter((f) => isFile(path.join(projectDir, f)));
}

/**
 * MAW workflows/harnesses living in the project's .maw/.
 * @param {string} projectDir
 */
function projectWorkflows(projectDir) {
  const out = [];
  const wf = path.join(projectDir, ".maw", "workflow.json");
  if (isFile(wf)) out.push({ name: "workflow.json", path: wf });
  const agents = path.join(projectDir, ".maw", "agents");
  if (exists(agents)) {
    try {
      for (const e of fs.readdirSync(agents)) {
        if (e.endsWith(".md")) out.push({ name: e.replace(/\.md$/, ""), path: path.join(agents, e) });
      }
    } catch {}
  }
  return out;
}

const DIGEST_MAX_LINES = 200;

/**
 * Render the compact agent-readable digest. Hard cap 200 lines; over budget
 * truncates name lists with "(+N more — see .maw/inventory.json)".
 * @param {InventoryReport} report
 * @returns {string}
 */
export function renderDigest(report) {
  const lines = [];
  lines.push(`# MAW cross-host inventory (generated ${report.generatedAt})`);
  lines.push(`Project: ${report.projectDir}`);
  lines.push("");
  for (const h of report.hosts ?? []) {
    if (h.error) { lines.push(`## ${h.app} — error: ${h.error}`); lines.push(""); continue; }
    lines.push(`## ${h.app} — caps: ${(h.capabilities || []).join(", ") || "none"}`);
    lines.push(`- home: ${h.homeDir}`);
    lines.push(`- skills (${h.skills.length}): ${nameList(h.skills.map((s) => s.name))}`);
    lines.push(`- plugins (${h.plugins.length}): ${nameList(h.plugins.map((p) => p.name))}`);
    lines.push(`- mcp (${h.mcps.length}): ${nameList(h.mcps.map((m) => m.name))}`);
    const models = (h.models || []).map((m) => {
      const tags = m.tags?.length ? ` [${m.tags.join(",")}]` : "";
      const price = m.price ? ` ($${m.price.input_per_m}/$${m.price.output_per_m} per M${m.price.estimated ? " est." : ""})` : "";
      return `${m.id}${tags}${price}`;
    });
    lines.push(`- models (${h.models.length}): ${nameList(models)}`);
    lines.push(`- prompts: global ${h.prompts?.global ? "✓" : "✗"} / project ${(h.prompts?.project || []).join("+") || "✗"}`);
    if (h.workflowsHarnesses?.length) lines.push(`- workflows: ${nameList(h.workflowsHarnesses.map((w) => w.name))}`);
    lines.push("");
  }
  if (lines.length > DIGEST_MAX_LINES) {
    lines.length = DIGEST_MAX_LINES;
    lines.push(`… truncated at ${DIGEST_MAX_LINES} lines — see .maw/inventory.json for the full report`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Comma-joined name list that yields "(+N more — see .maw/inventory.json)"
 * when it would blow the line budget (rough heuristic: ~110 names visible).
 * @param {string[]} names
 */
function nameList(names) {
  const visible = names.slice(0, 110);
  const rest = names.length - visible.length;
  return visible.join(", ") + (rest > 0 ? ` (+${rest} more — see .maw/inventory.json)` : "");
}

/**
 * Write .maw/inventory.json + .maw/inventory-digest.md.
 * @param {string} projectDir
 * @param {InventoryReport} report
 * @returns {{ jsonPath: string, digestPath: string }}
 */
export function writeInventoryArtifacts(projectDir, report) {
  const mawDir = path.join(projectDir, ".maw");
  ensureDir(mawDir);
  const jsonPath = path.join(mawDir, "inventory.json");
  const digestPath = path.join(mawDir, "inventory-digest.md");
  writeJson(jsonPath, report);
  writeText(digestPath, renderDigest(report));
  return { jsonPath, digestPath };
}
