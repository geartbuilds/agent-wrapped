import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { readConfig, saveConfig } from "./roast.js";

// Where anonymized aggregate runs are submitted. Leave BUILTIN_ENDPOINT empty
// until the leaderboard server is deployed; set it to the server's ingest URL
// (e.g. https://your-host.example.com/api/runs) and re-publish, or override per
// run with AGENT_WRAPPED_LEADERBOARD_URL. While empty, the leaderboard is fully
// inert — nothing is sent and the user is never prompted.
const BUILTIN_ENDPOINT = "https://agent-wrapped-leaderboard-production.up.railway.app/api/runs";

export function leaderboardEndpoint() {
  return process.env.AGENT_WRAPPED_LEADERBOARD_URL || BUILTIN_ENDPOINT || "";
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

// Stable per-machine anonymous id so repeat runs update one leaderboard row
// rather than spawning duplicates. Random, not derived from anything personal.
function anonId() {
  const cfg = readConfig();
  if (cfg.anonId) return cfg.anonId;
  const id = randomUUID();
  saveConfig({ anonId: id });
  return id;
}

// Resolve consent: explicit flag → saved config → one-time prompt (TTY only).
// Returns false (and never prompts) when no endpoint is configured.
export async function resolveLeaderboardConsent(flag) {
  if (!leaderboardEndpoint()) return false;
  if (flag === "on") return true;
  if (flag === "off") return false;
  const cfg = readConfig();
  if (typeof cfg.leaderboard === "boolean") return cfg.leaderboard;
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) return false;
  console.log(`
  ${"\x1b[1mJoin the public leaderboard?\x1b[0m"} ${"\x1b[2m(optional)\x1b[0m"}
  Submits ONLY your aggregate numbers (lines, sessions, est. spend, tokens, archetype)
  ${"\x1b[2m— never your code, prompts, or file names. You can leave anytime with --leaderboard off.\x1b[0m"}
`);
  const a = (await ask("  Join? [y/N]: ")).toLowerCase();
  const join = a === "y" || a === "yes";
  saveConfig({ leaderboard: join });
  return join;
}

// Anonymized aggregate payload — deliberately excludes file names and paths.
function payload(stats, handle, ts) {
  return {
    anonId: anonId(),
    handle: handle || null,
    period: stats.period.label,
    linesWritten: stats.linesWritten,
    sessions: stats.sessions,
    costUSD: Math.round(stats.costUSD * 100) / 100,
    tokens: stats.tokens.total,
    humanPrompts: stats.humanPrompts,
    peakHour: stats.peakHour,
    activeDays: stats.activeDays,
    longestStreak: stats.longestStreak,
    archetype: { name: stats.archetype.name, tier: stats.archetype.tier },
    favoriteTool: stats.favoriteTool || null,
    models: stats.models || [],
    clientTs: ts,
  };
}

// Best-effort submit. Returns { ok } / { error } / { skipped } — never throws.
export async function submitToLeaderboard(stats, handle, ts) {
  const url = leaderboardEndpoint();
  if (!url) return { skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(stats, handle, ts)),
    });
    if (!res.ok) return { error: `leaderboard responded ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, rank: data.rank, total: data.total };
  } catch (e) {
    return { error: "could not reach leaderboard (" + (e.message || e) + ")" };
  }
}
