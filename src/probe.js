// @ts-check
// Project probing: derive workflow signals from a real directory tree.
import fs from "node:fs";
import path from "node:path";

const CODE_EXT = new Set([
  ".js",".mjs",".cjs",".ts",".tsx",".jsx",".py",".go",".rs",".java",".kt",".rb",
  ".php",".c",".h",".cc",".cpp",".hpp",".cs",".swift",".scala",".sh",".vue",".svelte",".lua",".dart",".ex",".exs",".heex",".clj",".cljs"
]);
const IGNORE = new Set([
  "node_modules",".git","dist","build","out","target",".next",".turbo","venv",".venv","__pycache__",".cache","coverage",".maw"
]);

/**
 * Probe a project directory.
 * @param {string} root
 * @param {{ maxFiles?: number }} [opts]
 * @returns {{ files: number, loc: number, languages: string[], root: string }}
 */
export function probeProject(root, opts = {}) {
  const max = opts.maxFiles ?? 20000;
  let files = 0, loc = 0;
  const exts = new Set();
  const walk = (/** @type {string} */ dir) => {
    if (files > max) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!IGNORE.has(e.name)) walk(path.join(dir, e.name)); }
      else {
        files++;
        const ext = path.extname(e.name).toLowerCase();
        if (CODE_EXT.has(ext)) {
          exts.add(ext);
          try {
            const t = fs.readFileSync(path.join(dir, e.name), "utf8");
            loc += t.split("\n").length;
          } catch {}
        }
      }
      if (files > max) return;
    }
  };
  walk(root || ".");
  const languages = [...exts].map((e) => e.replace(/^\./, ""));
  return { files, loc, languages, root };
}
