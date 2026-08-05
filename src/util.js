// @ts-check
// Small, dependency-free helpers shared across the engine.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** @returns {string} */
export function home() {
  return os.homedir();
}

/** @param {string} p */
export function expand(p) {
  if (!p) return p;
  if (p === "~") return home();
  if (p.startsWith("~/")) return path.join(home(), p.slice(2));
  if (p.startsWith("~" + path.sep)) return path.join(home(), p.slice(2));
  return path.resolve(p);
}

/** @param {string} dir */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** @param {string} file @param {string} [data] @param {object} [opts] */
export function writeText(file, data, opts) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, data ?? "", opts ?? {});
  return file;
}

/** @param {string} file */
export function readText(file) {
  return fs.readFileSync(file, "utf8");
}

/** @param {string} file @param {any} obj */
export function writeJson(file, obj) {
  return writeText(file, JSON.stringify(obj, null, 2) + "\n");
}

/** @param {string} file @param {any} [fallback] */
export function readJson(file, fallback) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return fallback;
  }
}

/** @param {string} file @returns {boolean} */
export function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} file @returns {boolean} */
export function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {unknown} v
 * @param {string} msg
 */
export function assert(v, msg) {
  if (!v) throw new Error(msg);
}

/** @param {number} n @param {number} d */
export function round(n, d = 4) {
  const m = 10 ** d;
  return Math.round((n + Number.EPSILON) * m) / m;
}

/** @param {string} s */
export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/** @param {string} s */
export function yamlQuote(s) {
  if (s == null) return "''";
  const str = String(s);
  if (/^[\d.\-+]/.test(str) || /[:#\[\]{},&\*!|>'"%@`]/.test(str) || str === "" || str === "true" || str === "false" || str === "null") {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * @param {Record<string, any>} obj
 * @param {number} [indent]
 */
export function toYaml(obj, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [];
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return String(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      for (const item of v) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          lines.push(`${pad}- `);
          const sub = toYaml(item, indent + 2).replace(new RegExp("^" + " ".repeat(indent + 2), "gm"), " ".repeat(indent + 2)).trimStart();
          // indent the nested block under the dash
          lines[lines.length - 1] += sub.replace(/\n/g, "\n" + " ".repeat(indent + 2));
        } else {
          lines.push(`${pad}- ${yamlQuote(String(item))}`);
        }
      }
    } else if (typeof v === "object") {
      lines.push(`${pad}${k}:`);
      lines.push(toYaml(v, indent + 2));
    } else if (typeof v === "number" || typeof v === "boolean") {
      lines.push(`${pad}${k}: ${String(v)}`);
    } else {
      lines.push(`${pad}${k}: ${yamlQuote(String(v))}`);
    }
  }
  return lines.join("\n") + (indent === 0 ? "\n" : "");
}

/** @param {string[]} xs @param {string} sep */
export function joinNl(xs, sep = "\n") {
  return xs.join(sep);
}

/** @returns {number} epoch seconds */
export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** @returns {string} ISO timestamp */
export function isoNow() {
  return new Date().toISOString();
}
