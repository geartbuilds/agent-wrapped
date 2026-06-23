// Sample stats for the public landing page and README hero — realistic but
// fabricated, so we never broadcast a real person's numbers. The "2 AM Shipper"
// is the most fun archetype to lead with.
const hourHistogram = [
  9, 14, 22, 18, 7, 2, 1, 1, 3, 6, 9, 11,
  13, 12, 10, 9, 8, 10, 12, 15, 17, 16, 13, 11,
];

export const DEMO = {
  period: { start: 0, end: 0, label: "This Month" },
  sessions: 87,
  projects: 6,
  models: ["claude-opus-4-8", "claude-sonnet-4-6"],
  versions: [],
  costUSD: 42.17,
  linesWritten: 18432,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 312_000_000 },
  assistantMsgs: 0,
  humanPrompts: 412,
  toolCounts: {},
  favoriteTool: "Edit",
  hourHistogram,
  weekdayHistogram: [12, 18, 16, 19, 14, 5, 3],
  peakHour: 2,
  topFile: { path: "src/app.tsx", name: "app.tsx", edits: 34, lines: 1290 },
  activeDays: 19,
  longestStreak: 8,
  biggestSessionUSD: 6.4,
  rank: 3,
  total: 100,
  rankLabel: "TOP 3%",
  firstTs: null,
  lastTs: null,
  archetype: { emoji: "🌙", name: "The 2 AM Shipper", tier: "Heavy Hitter", title: "The 2 AM Shipper" },
};
