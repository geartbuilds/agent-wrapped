#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { claudeDirs, findTranscripts } from "../src/discover.js";
import { computeStats } from "../src/stats.js";
import { renderCard } from "../src/card.js";
import { resolveRoastMode, generateRoast } from "../src/roast.js";
import { resolveLeaderboardConsent, submitToLeaderboard } from "../src/leaderboard.js";

const argv = process.argv.slice(2);
const opts = parseArgs(argv);

if (opts.help) {
  printHelp();
  process.exit(0);
}

const C = {
  pp: (s) => `\x1b[38;5;177m${s}\x1b[0m`,
  cy: (s) => `\x1b[38;5;51m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

const dirs = claudeDirs(opts.dir);
if (!dirs.length) {
  console.error(`\n  Couldn't find any Claude Code logs on this machine.`);
  console.error(`  Looked in ${C.b("~/.claude")} and ${C.b("~/.config/claude")}.`);
  console.error(`  Point me at the folder that contains "projects" with ${C.b("--dir <path>")}.\n`);
  process.exit(1);
}

const transcripts = findTranscripts(dirs);
if (!transcripts.length) {
  console.error(`\n  No transcripts found under: ${dirs.map((d) => join(d, "projects")).join(", ")}\n`);
  process.exit(1);
}

const where = dirs.length > 1 ? ` from ${dirs.length} Claude locations` : "";
console.log(`\n  ${C.pp("✦")} Parsing ${C.b(transcripts.length)} transcripts${where} ${C.dim("(100% local — nothing uploaded)")}…`);

const stats = await computeStats(transcripts, opts);

if (opts.json) {
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

// Optional AI roast line. The user chooses, once, whether to generate it via
// their Claude Code subscription (local `claude`) or an Anthropic API key.
const roastMode = await resolveRoastMode(opts.roast);
if (roastMode && roastMode !== "off") {
  const via = roastMode === "subscription" ? "Claude Code" : "Anthropic API";
  process.stdout.write(`  ${C.pp("✦")} Writing your roast via ${C.b(via)}… `);
  const r = await generateRoast(stats, roastMode, opts.roastModel);
  if (r.roast) {
    stats.roast = r.roast;
    console.log(C.cy("done"));
  } else if (r.error) {
    console.log(C.dim("skipped"));
    console.log(`  ${C.dim("(" + r.error + ")")}`);
  } else {
    console.log("");
  }
}

// Optional leaderboard (inert unless a server endpoint is configured). Ask for
// consent here, alongside the roast prompt, before the summary is printed.
const joinBoard = await resolveLeaderboardConsent(opts.leaderboard);

printSummary(stats);

if (joinBoard) {
  process.stdout.write(`  ${C.pp("✦")} Submitting to the leaderboard… `);
  const r = await submitToLeaderboard(stats, opts.handle, new Date().toISOString());
  if (r.ok && r.rank && r.total) {
    stats.rank = r.rank;
    stats.total = r.total;
    const pct = Math.max(1, Math.round((r.rank / r.total) * 100));
    stats.rankLabel = r.total >= 10 ? `TOP ${pct}%` : `#${r.rank} of ${r.total}`;
    console.log(C.cy(stats.rankLabel));
  } else {
    console.log(r.ok ? C.cy("done") : C.dim("skipped" + (r.error ? " (" + r.error + ")" : "")));
  }
}

const html = renderCard(stats, { handle: opts.handle });
const outPath = opts.out
  ? resolve(opts.out)
  : join(tmpdir(), `agent-wrapped-${Date.now()}.html`);
writeFileSync(outPath, html, "utf8");

if (!opts.noOpen) openInBrowser(outPath);

printOutro(outPath, !opts.noOpen);

// ---------------------------------------------------------------------------

function printOutro(outPath, opened) {
  const line = C.dim("  " + "─".repeat(46));
  console.log(`
${line}
  ${C.pp("✓")} ${C.b("Okay, this ran!")} Your Agent Wrapped is ready.
${line}
  ${C.cy("1.")} ${opened ? "Your card just opened in the browser" : "Open your card"} — ${C.b("pick a theme")} and hit ${C.b("Download PNG")}.
     ${C.dim(outPath)}
  ${C.cy("2.")} Post it and tag ${C.b("@geartbuilds")}. Get yours: ${C.b("npx github:geartbuilds/agent-wrapped")}
${line}
`);
}

function printSummary(s) {
  const money = "$" + s.costUSD.toFixed(2);
  const tok = s.tokens.total >= 1e6 ? (s.tokens.total / 1e6).toFixed(1) + "M" : Math.round(s.tokens.total / 1e3) + "k";
  const peak = hr(s.peakHour);
  console.log(`
  ${C.b("AGENT WRAPPED")} ${C.dim("·")} ${C.pp(s.period.label)}
  ${C.dim("─".repeat(46))}
  ${C.b(s.archetype.emoji + "  " + s.archetype.name)}  ${C.dim("(" + s.archetype.tier + ")")}
  ${C.dim("─".repeat(46))}
   Lines your agent wrote   ${C.cy(s.linesWritten.toLocaleString())}
   Sessions                 ${s.sessions.toLocaleString()}
   Spent (estimated)        ${C.cy(money)}
   Tokens                   ${tok}
   Your prompts             ${s.humanPrompts.toLocaleString()}
   Active days              ${s.activeDays}  ${C.dim("(longest streak " + s.longestStreak + "d)")}
   Busiest hour             ${C.cy(peak)}
   Most-edited file         ${s.topFile ? s.topFile.name + C.dim(" (" + s.topFile.edits + " edits)") : "—"}
   Favorite tool            ${s.favoriteTool || "—"}
  ${C.dim("─".repeat(46))}${s.roast ? `\n  ${C.pp("“")}${s.roast}${C.pp("”")}\n  ${C.dim("─".repeat(46))}` : ""}`);
}

function hr(h) {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function openInBrowser(path) {
  const platform = process.platform;
  try {
    if (platform === "win32") spawn("cmd", ["/c", "start", "", path], { detached: true, stdio: "ignore" }).unref();
    else if (platform === "darwin") spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* opening is best-effort */
  }
}

function parseArgs(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === "--all") o.all = true;
    else if (a === "--json") o.json = true;
    else if (a === "--no-open") o.noOpen = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--days") o.days = Number(next());
    else if (a.startsWith("--days=")) o.days = Number(a.split("=")[1]);
    else if (a === "--month") o.month = next();
    else if (a.startsWith("--month=")) o.month = a.split("=")[1];
    else if (a === "--dir") (o.dir ||= []).push(next());
    else if (a.startsWith("--dir=")) (o.dir ||= []).push(a.split("=")[1]);
    else if (a === "--out") o.out = next();
    else if (a.startsWith("--out=")) o.out = a.split("=")[1];
    else if (a === "--handle") o.handle = next();
    else if (a.startsWith("--handle=")) o.handle = a.split("=")[1];
    else if (a === "--no-roast") o.roast = "off";
    else if (a === "--roast") o.roast = next();
    else if (a.startsWith("--roast=")) o.roast = a.split("=")[1];
    else if (a === "--roast-model") o.roastModel = next();
    else if (a.startsWith("--roast-model=")) o.roastModel = a.split("=")[1];
    else if (a === "--no-leaderboard") o.leaderboard = "off";
    else if (a === "--leaderboard") o.leaderboard = next();
    else if (a.startsWith("--leaderboard=")) o.leaderboard = a.split("=")[1];
  }
  return o;
}

function printHelp() {
  console.log(`
  agent-wrapped — Spotify Wrapped for your AI coding

  Usage:  npx agent-wrapped [options]

  Options:
    --all            All-time stats (default: current month)
    --month YYYY-MM  Stats for a specific month
    --days N         Stats for the trailing N days
    --dir <path>     Claude data dir (repeatable). Default: auto-scan
                     ~/.claude and ~/.config/claude (covers every project)
    --out <file>     Write the card HTML to a specific path
    --handle <name>  Handle shown on the card (default: @geartbuilds)
    --roast <mode>   AI roast line: subscription | api | off
                     (subscription = local Claude Code; api = ANTHROPIC_API_KEY)
    --roast-model M  Model for the api roast (default: claude-haiku-4-5)
    --no-roast       Skip the AI roast (same as --roast off)
    --leaderboard <on|off>   Join/leave the public leaderboard (opt-in)
    --no-leaderboard Don't submit to the leaderboard
    --json           Print raw stats as JSON and exit
    --no-open        Don't auto-open the card in a browser
    -h, --help       Show this help

  Everything runs locally. No code, prompts, or logs ever leave your machine.
`);
}
