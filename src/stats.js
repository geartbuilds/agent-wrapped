import { streamTranscript, linesAuthored, filePathOf } from "./parser.js";
import { costForUsage } from "./pricing.js";

// ---- period helpers ---------------------------------------------------------

// Resolve a {start,end} window in epoch ms (local time) from CLI options.
// Default: the current calendar month. --all: everything. --days N: trailing N days.
export function resolvePeriod(opts = {}, now = new Date()) {
  if (opts.all) return { start: 0, end: Infinity, label: "All time" };
  if (opts.days) {
    const end = now.getTime();
    return { start: end - opts.days * 86400000, end, label: `Last ${opts.days} days` };
  }
  if (opts.month) {
    const [y, m] = opts.month.split("-").map(Number);
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m, 1).getTime();
    return { start, end, label: monthLabel(y, m - 1) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return { start, end, label: monthLabel(now.getFullYear(), now.getMonth()) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
function monthLabel(y, mIdx) {
  return `${MONTHS[mIdx]} ${y}`;
}

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function longestStreak(daySet) {
  const days = [...daySet].sort();
  if (!days.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1] + "T00:00:00");
    const here = new Date(days[i] + "T00:00:00");
    const gap = Math.round((here - prev) / 86400000);
    if (gap === 1) cur++;
    else cur = 1;
    if (cur > best) best = cur;
  }
  return best;
}

// ---- main aggregation -------------------------------------------------------

export async function computeStats(transcripts, opts = {}) {
  const period = resolvePeriod(opts);
  const seen = new Set(); // dedupe by uuid across nested transcripts

  const agg = {
    sessions: new Set(),
    projects: new Set(),
    models: new Set(),
    versions: new Set(),
    costUSD: 0,
    linesWritten: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    assistantMsgs: 0,
    humanPrompts: 0,
    toolCounts: {},
    hourHistogram: new Array(24).fill(0),
    weekdayHistogram: new Array(7).fill(0),
    fileEdits: {}, // path -> { edits, lines }
    activeDays: new Set(),
    sessionCost: {}, // sessionId -> cost (for "biggest session")
    firstTs: Infinity,
    lastTs: -Infinity,
  };

  const inPeriod = (ts) => ts >= period.start && ts < period.end;

  for (const path of transcripts) {
    await streamTranscript(path, (o) => {
      if (o.uuid) {
        if (seen.has(o.uuid)) return;
        seen.add(o.uuid);
      }
      const ts = o.timestamp ? Date.parse(o.timestamp) : null;
      if (ts != null && !Number.isNaN(ts) && !inPeriod(ts)) return;

      if (o.sessionId) agg.sessions.add(o.sessionId);
      if (o.cwd) agg.projects.add(o.cwd);
      if (o.version) agg.versions.add(o.version);

      if (ts != null && !Number.isNaN(ts)) {
        const d = new Date(ts);
        agg.hourHistogram[d.getHours()]++;
        agg.weekdayHistogram[d.getDay()]++;
        agg.activeDays.add(localDayKey(d));
        if (ts < agg.firstTs) agg.firstTs = ts;
        if (ts > agg.lastTs) agg.lastTs = ts;
      }

      const msg = o.message;

      // Human prompts: user events whose content isn't purely a tool_result.
      if (o.type === "user" && msg) {
        const c = msg.content;
        const isToolResult =
          Array.isArray(c) && c.length && c.every((b) => b && b.type === "tool_result");
        if (!isToolResult) agg.humanPrompts++;
      }

      if (o.type !== "assistant" || !msg) return;
      agg.assistantMsgs++;
      if (msg.model) agg.models.add(msg.model);

      if (msg.usage) {
        const u = msg.usage;
        agg.tokensIn += u.input_tokens || 0;
        agg.tokensOut += u.output_tokens || 0;
        agg.tokensCacheRead += u.cache_read_input_tokens || 0;
        agg.tokensCacheWrite += u.cache_creation_input_tokens || 0;
        const c = costForUsage(msg.model, u);
        agg.costUSD += c;
        if (o.sessionId) agg.sessionCost[o.sessionId] = (agg.sessionCost[o.sessionId] || 0) + c;
      }

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || block.type !== "tool_use") continue;
          agg.toolCounts[block.name] = (agg.toolCounts[block.name] || 0) + 1;
          const lines = linesAuthored(block);
          if (lines) {
            agg.linesWritten += lines;
            const fp = filePathOf(block);
            if (fp) {
              const rec = agg.fileEdits[fp] || (agg.fileEdits[fp] = { edits: 0, lines: 0 });
              rec.edits++;
              rec.lines += lines;
            }
          }
        }
      }
    });
  }

  return finalize(agg, period);
}

function finalize(agg, period) {
  const peakHour = agg.hourHistogram.indexOf(Math.max(...agg.hourHistogram));
  const topFileEntry = Object.entries(agg.fileEdits).sort((a, b) => b[1].edits - a[1].edits)[0];
  const favoriteTool =
    Object.entries(agg.toolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const biggestSession =
    Object.entries(agg.sessionCost).sort((a, b) => b[1] - a[1])[0]?.[1] || 0;

  return {
    period,
    sessions: agg.sessions.size,
    projects: agg.projects.size,
    models: [...agg.models],
    versions: [...agg.versions],
    costUSD: agg.costUSD,
    linesWritten: agg.linesWritten,
    tokens: {
      input: agg.tokensIn,
      output: agg.tokensOut,
      cacheRead: agg.tokensCacheRead,
      cacheWrite: agg.tokensCacheWrite,
      total: agg.tokensIn + agg.tokensOut + agg.tokensCacheRead + agg.tokensCacheWrite,
    },
    assistantMsgs: agg.assistantMsgs,
    humanPrompts: agg.humanPrompts,
    toolCounts: agg.toolCounts,
    favoriteTool,
    hourHistogram: agg.hourHistogram,
    weekdayHistogram: agg.weekdayHistogram,
    peakHour,
    topFile: topFileEntry
      ? { path: topFileEntry[0], name: basename(topFileEntry[0]), ...topFileEntry[1] }
      : null,
    activeDays: agg.activeDays.size,
    longestStreak: longestStreak(agg.activeDays),
    biggestSessionUSD: biggestSession,
    firstTs: agg.firstTs === Infinity ? null : agg.firstTs,
    lastTs: agg.lastTs === -Infinity ? null : agg.lastTs,
    archetype: archetypeFor(peakHour, agg.costUSD, agg.linesWritten),
  };
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

// Two-part identity: a time-of-day persona + a volume tier. Both are designed
// to be screenshot-worthy, because identity is what people share.
function archetypeFor(peakHour, cost, lines) {
  let persona;
  if (peakHour <= 4) persona = { name: "The 2 AM Shipper", emoji: "🌙" };
  else if (peakHour <= 8) persona = { name: "The Dawn Patrol", emoji: "🌅" };
  else if (peakHour <= 12) persona = { name: "The Morning Builder", emoji: "☕" };
  else if (peakHour <= 17) persona = { name: "The Daylight Grinder", emoji: "🌞" };
  else if (peakHour <= 21) persona = { name: "The Prime-Time Coder", emoji: "🌆" };
  else persona = { name: "The Midnight Operator", emoji: "🌃" };

  let tier;
  if (cost >= 200 || lines >= 50000) tier = "Token Whale";
  else if (cost >= 50 || lines >= 15000) tier = "Heavy Hitter";
  else if (cost >= 10 || lines >= 3000) tier = "Regular";
  else tier = "Weekend Warrior";

  return { ...persona, tier, title: `${persona.name}` };
}
