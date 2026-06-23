// Model pricing in USD per 1,000,000 tokens. Estimates based on published
// Anthropic API rates; used to approximate spend (Claude Code logs carry no cost field).
// Matched by substring against the model id (e.g. "claude-opus-4-8").
const TIERS = {
  opus:   { input: 15,  output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3,   output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  haiku:  { input: 1,   output: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
};

// Fallback tier when a model id matches nothing known.
const DEFAULT_TIER = TIERS.sonnet;

export function tierForModel(model = "") {
  const m = String(model).toLowerCase();
  if (m.includes("opus")) return TIERS.opus;
  if (m.includes("sonnet")) return TIERS.sonnet;
  if (m.includes("haiku")) return TIERS.haiku;
  return DEFAULT_TIER;
}

// usage: the message.usage object from a Claude Code assistant event.
// Returns estimated USD cost for that single response.
export function costForUsage(model, usage = {}) {
  const t = tierForModel(model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    (input * t.input +
      output * t.output +
      cacheWrite * t.cacheWrite +
      cacheRead * t.cacheRead) /
    1_000_000
  );
}
