import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const CONFIG_PATH = join(homedir(), ".agent-wrapped.json");

export function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
  return cfg;
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

// First-run choice: how should the AI roast be generated? Remembered after.
async function promptForMode() {
  console.log(`
  One last thing — Agent Wrapped can add an AI-written ${"\x1b[1mroast"}\x1b[0m of your coding habits to the card.
  How should it talk to Claude? ${"\x1b[2m(only your aggregate stats are sent, never code or prompts)\x1b[0m"}

    ${"\x1b[38;5;51m1)\x1b[0m"} Claude Code subscription   ${"\x1b[2m— uses your local `claude` CLI, no API key, no extra cost\x1b[0m"}
    ${"\x1b[38;5;51m2)\x1b[0m"} Anthropic API key           ${"\x1b[2m— uses $ANTHROPIC_API_KEY (Haiku, ~$0.001/run)\x1b[0m"}
    ${"\x1b[38;5;51m3)\x1b[0m"} No roast                    ${"\x1b[2m— skip it\x1b[0m"}
`);
  const a = await ask("  Choose 1, 2 or 3: ");
  if (a === "1") return "subscription";
  if (a === "2") return "api";
  return "off";
}

// Resolve the roast mode from (in order): explicit flag, saved config, or an
// interactive prompt on first run. Non-interactive runs with no preference skip.
export async function resolveRoastMode(flagMode) {
  if (flagMode) return flagMode; // --roast subscription|api|off
  const saved = readConfig().roastMode;
  if (saved) return saved;
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) return "off";
  const chosen = await promptForMode();
  saveConfig({ roastMode: chosen });
  console.log(`  ${"\x1b[2m"}Saved. Change anytime with --roast subscription|api|off${"\x1b[0m"}\n`);
  return chosen;
}

function buildPrompt(s) {
  const usd = "$" + s.costUSD.toFixed(2);
  const hr = (h) => (h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`);
  return [
    `Roast this developer based on their AI coding stats for ${s.period.label}.`,
    `Write ONE witty, playful, good-natured roast line — max 120 characters.`,
    `Be specific to the numbers. No quotes, no emoji, no preamble. Output only the line.`,
    ``,
    `Lines their AI agent wrote: ${s.linesWritten}`,
    `Sessions: ${s.sessions}`,
    `Estimated spend: ${usd}`,
    `Busiest hour: ${hr(s.peakHour)}`,
    `Their own prompts typed: ${s.humanPrompts}`,
    `Most-edited file: ${s.topFile ? s.topFile.name : "n/a"}`,
    `Archetype: ${s.archetype.name} (${s.archetype.tier})`,
    `Favorite tool: ${s.favoriteTool || "n/a"}`,
  ].join("\n");
}

function cleanLine(text) {
  if (!text) return null;
  let t = text.trim().split("\n").find((l) => l.trim()) || "";
  t = t.trim().replace(/^["'`]|["'`]$/g, "").trim();
  return t || null;
}

// Subscription path: the local Claude Code CLI in headless print mode. Uses the
// user's existing Claude Code auth — no API key. The prompt is piped via stdin
// (not argv), so there's no shell-injection surface and no arg-quoting issues.
// On Windows we invoke via `cmd /c` (no shell:true) so the launcher resolves
// `claude.cmd` from PATHEXT without tripping Node's DEP0190 warning.
function viaClaudeCLI(prompt) {
  const win = process.platform === "win32";
  const cmd = win ? "cmd" : "claude";
  const args = win ? ["/c", "claude", "-p"] : ["-p"];
  const res = spawnSync(cmd, args, {
    input: prompt,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error && res.error.code === "ENOENT") {
    return { error: "Claude Code CLI ('claude') not found on PATH. Install it, or use --roast api." };
  }
  if (res.status === 0) return cleanLine(res.stdout);
  const stderr = (res.stderr || "").trim();
  if (/not recognized|command not found/i.test(stderr)) {
    return { error: "Claude Code CLI ('claude') not found on PATH. Install it, or use --roast api." };
  }
  return { error: stderr.split("\n")[0] || "claude exited with a non-zero status." };
}

// API path: raw POST /v1/messages (keeps the package zero-dependency). Defaults
// to Haiku — a one-liner doesn't need more, and the user pays per call.
async function viaAPI(prompt, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "ANTHROPIC_API_KEY is not set. Set it, or use --roast subscription." };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      let msg = `Anthropic API error ${res.status}`;
      try {
        const e = await res.json();
        if (e?.error?.message) msg += `: ${e.error.message}`;
      } catch {
        /* ignore */
      }
      return { error: msg };
    }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return cleanLine(text);
  } catch (e) {
    return { error: "Network error calling Anthropic API: " + (e.message || e) };
  }
}

// Returns { roast: string } on success, { skipped: true } if off, or
// { error: string } so the CLI can warn without failing the whole run.
export async function generateRoast(stats, mode, model) {
  if (mode === "off" || !mode) return { skipped: true };
  const prompt = buildPrompt(stats);
  const out = mode === "subscription" ? viaClaudeCLI(prompt) : await viaAPI(prompt, model);
  const resolved = out && typeof out.then === "function" ? await out : out;
  if (resolved && resolved.error) return { error: resolved.error };
  if (!resolved) return { error: "No roast returned." };
  return { roast: resolved };
}
