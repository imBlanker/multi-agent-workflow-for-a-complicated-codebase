// @ts-check
// Detect the supported host agent software and its capabilities, so the
// planner can prefer native dynamic-workflow / multi-agent mechanisms when the
// host provides them instead of re-implementing them.
//
// Supported hosts are narrowed to ONLY Claude Code and Codex (project policy).
// Other agent software (Gemini CLI, opencode, …) is NOT supported; their
// cc-switch pricing data may still be READ for cost estimates.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exists, readJson } from "./util.js";

/**
 * @typedef {"claude-code"|"codex"|"unknown"} HostApp
 * Note: only claude-code and codex are supported. Everything else is "unknown".
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
 * @param {string} [opts.claudeDir]  override ~/.claude
 * @param {string} [opts.codexDir]   override ~/.codex
 * @returns {HostInfo}
 */
export function detectHost(opts = {}) {
  const detected = [];
  const claudeDir = opts.claudeDir ?? path.join(home(), ".claude");
  const codexDir = opts.codexDir ?? path.join(home(), ".codex");

  let /** @type {HostApp} */ app = "unknown";
  let homeDir = "";
  const skillsDirs = [];
  const commandsDirs = [];
  const agentsDirs = [];

  if (exists(claudeDir)) {
    app = "claude-code";
    homeDir = claudeDir;
    detected.push(`Claude Code home at ${claudeDir}`);
    skillsDirs.push(path.join(claudeDir, "skills"));
    commandsDirs.push(path.join(claudeDir, "commands"));
    agentsDirs.push(path.join(claudeDir, "agents"));
  }

  // Supported hosts are Claude Code and Codex ONLY. Gemini CLI / opencode /
  // others are intentionally NOT detected as supported (they may still be
  // read for pricing).
  const codexBinary = sh("command -v codex 2>/dev/null || which codex 2>/dev/null") || null;
  if (exists(codexDir)) {
    detected.push(`Codex home at ${codexDir}`);
    if (app === "unknown") { app = "codex"; homeDir = codexDir; }
    agentsDirs.push(path.join(codexDir, "agents"));
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

  const hasSubagents = app === "claude-code" || app === "codex";
  const hasMultiAgent = app === "claude-code";
  const hasDynamicWorkflow = app === "claude-code";
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
