// @ts-check
// Detect the supported host agent software and its capabilities, so the
// planner can prefer native dynamic-workflow / multi-agent mechanisms when the
// host provides them instead of re-implementing them.
//
// Supported hosts are Claude Code, Codex, and Pi Agent (project policy).
// Other agent software (Gemini CLI, opencode, …) is NOT supported; their
// cc-switch pricing data may still be READ for cost estimates.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exists, readJson } from "./util.js";

/**
 * @typedef {"claude-code"|"codex"|"pi"|"unknown"} HostApp
 * Note: claude-code, codex, and pi are supported. Everything else is "unknown".
 * @typedef {{
 *   app: HostApp,
 *   homeDir: string,
 *   hasSubagents: boolean,
 *   hasMultiAgent: boolean,
 *   hasDynamicWorkflow: boolean,
 *   hasGraphWorkflow: boolean,
 *   codexPluginInstalled: boolean,
 *   codexBinary: string|null,
 *   skillsDirs: string[],
 *   commandsDirs: string[],
 *   agentsDirs: string[],
 *   extensionsDirs: string[],
 *   detected: string[]
 * }} HostInfo
 */

/** @returns {string} */
function home() {
  return os.homedir();
}

/**
 * Run a shell command, returning trimmed stdout or "" on failure.
 * @param {string} cmd
 */
function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Detect installed host agent software and its capabilities.
 * @param {object} [opts]
 * @param {string} [opts.claudeDir]   override ~/.claude
 * @param {string} [opts.codexDir]    override ~/.codex
 * @param {string} [opts.piDir]       override ~/.pi/agent
 * @param {string} [opts.projectDir]  override process.cwd() (for project-level .pi/ dirs)
 * @returns {HostInfo}
 */
export function detectHost(opts = {}) {
  const detected = [];
  const claudeDir = opts.claudeDir ?? path.join(home(), ".claude");
  const codexDir = opts.codexDir ?? path.join(home(), ".codex");
  const piDir = opts.piDir ?? (process.env.PI_AGENT_DIR || path.join(home(), ".pi", "agent"));
  const projectDir = opts.projectDir ?? process.cwd();
  const envHost = (process.env.MAW_HOST || "").toLowerCase();

  let /** @type {HostApp} */ app = "unknown";
  let homeDir = "";
  const skillsDirs = [];
  const commandsDirs = [];
  const agentsDirs = [];
  const extensionsDirs = [];

  if (exists(claudeDir)) {
    app = "claude-code";
    homeDir = claudeDir;
    detected.push(`Claude Code home at ${claudeDir}`);
    skillsDirs.push(path.join(claudeDir, "skills"));
    commandsDirs.push(path.join(claudeDir, "commands"));
    agentsDirs.push(path.join(claudeDir, "agents"));
  }

  // Supported hosts are Claude Code, Codex, and Pi Agent. Gemini CLI /
  // opencode / others are intentionally NOT detected as supported (they may
  // still be read for pricing).
  const codexBinary = sh("command -v codex 2>/dev/null || which codex 2>/dev/null") || null;
  if (exists(codexDir)) {
    detected.push(`Codex home at ${codexDir}`);
    if (envHost !== "pi" && app === "unknown") { app = "codex"; homeDir = codexDir; }
    agentsDirs.push(path.join(codexDir, "agents"));
  }

  // Pi Agent manages its own config in ~/.pi/agent/ (NOT via cc-switch).
  // Detect it as a supported host; project-level .pi/ dirs + global ~/.pi/agent/
  // dirs feed the installer. MAW_HOST=pi forces app="pi" even when Claude Code
  // is also installed (otherwise Claude Code keeps precedence).
  if (exists(piDir)) {
    detected.push(`Pi Agent home at ${piDir}`);
    agentsDirs.push(path.join(projectDir, ".pi", "agents"));
    agentsDirs.push(path.join(piDir, "agents"));
    commandsDirs.push(path.join(projectDir, ".pi", "prompts"));
    commandsDirs.push(path.join(piDir, "prompts"));
    skillsDirs.push(path.join(projectDir, ".agents", "skills"));
    extensionsDirs.push(path.join(projectDir, ".pi", "extensions"));
    extensionsDirs.push(path.join(piDir, "extensions"));
    if (envHost === "pi") { app = "pi"; homeDir = piDir; }
    else if (app === "unknown") { app = "pi"; homeDir = piDir; }
  }

  let codexPluginInstalled = false;
  const installedPlugins = path.join(claudeDir, "plugins", "installed_plugins.json");
  if (exists(installedPlugins)) {
    const data = readJson(installedPlugins, { plugins: {} });
    const keys = Object.keys(data?.plugins ?? {});
    codexPluginInstalled = keys.some((k) => k.toLowerCase().includes("codex"));
    if (codexPluginInstalled) detected.push("codex-plugin-cc installed");
  }
  const codexMarketplace = path.join(claudeDir, "plugins", "marketplaces", "openai-codex");
  if (exists(codexMarketplace)) {
    codexPluginInstalled = true;
    detected.push("openai-codex marketplace present");
  }

  const hasSubagents = app === "claude-code" || app === "codex" || app === "pi";
  const hasMultiAgent = app === "claude-code" || app === "pi";
  const hasDynamicWorkflow = app === "claude-code" || app === "pi";
  const hasGraphWorkflow = false;

  return {
    app,
    homeDir,
    hasSubagents,
    hasMultiAgent,
    hasDynamicWorkflow,
    hasGraphWorkflow,
    codexPluginInstalled,
    codexBinary,
    skillsDirs: [...new Set(skillsDirs)],
    commandsDirs: [...new Set(commandsDirs)],
    agentsDirs: [...new Set(agentsDirs)],
    extensionsDirs: [...new Set(extensionsDirs)],
    detected,
  };
}

/** @param {HostInfo} h @returns {string[]} */
export function hostCapabilities(h) {
  const caps = [];
  if (h.hasSubagents) caps.push("subagents");
  if (h.hasMultiAgent) caps.push("multi-agent");
  if (h.hasDynamicWorkflow) caps.push("dynamic-workflow");
  if (h.hasGraphWorkflow) caps.push("graph-workflow");
  if (h.codexPluginInstalled) caps.push("codex-review");
  return caps;
}
