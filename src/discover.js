import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

// All the standard places Claude Code may keep its data. We scan every one
// that exists so a run covers your ENTIRE laptop's history, regardless of
// which folder the terminal is in. (Claude Code stores all projects' sessions
// under a single global dir, keyed by project path — it is never scoped to the
// current working directory.)
export function claudeDirs(overrides) {
  // Explicit --dir flag(s) win and short-circuit auto-discovery.
  if (overrides && overrides.length) return dedupe(overrides);

  const home = homedir();
  const candidates = [
    process.env.CLAUDE_CONFIG_DIR,
    join(home, ".claude"),
    join(home, ".config", "claude"),
  ].filter(Boolean);

  return dedupe(candidates).filter(looksLikeClaudeDir);
}

function dedupe(arr) {
  return [...new Set(arr)];
}

// Recursively collect every *.jsonl transcript under each dir's projects/.
// Nested folders (sub-agent / sidechain transcripts) are included; the stats
// layer dedupes events by uuid so nothing is double counted.
export function findTranscripts(dirs) {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const out = [];
  for (const dir of list) {
    const root = join(dir, "projects");
    if (!existsSync(root)) continue;
    walk(root, out);
  }
  return out;
}

function walk(d, out) {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
}

// Does this look like a real Claude dir (has a projects/ subfolder)?
export function looksLikeClaudeDir(dir) {
  return existsSync(join(dir, "projects"));
}

export function fileMtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
