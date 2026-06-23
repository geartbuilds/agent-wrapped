import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, "styles.css"), "utf8");
const CLIENT = readFileSync(join(here, "client.js"), "utf8");

const THEME_BUTTONS = [
  ["dark", "Dark"],
  ["cosmic", "Cosmic"],
  ["light", "Light"],
  ["minimal", "Minimal"],
  ["pastel", "Pastel"],
]
  .map(([k, label]) => `<button class="tbtn" data-set="${k}">${label}</button>`)
  .join("");

// Assemble a full, self-contained HTML page. `bootstrap` is the JS that supplies
// the stats and calls AgentWrapped.render — it differs between the local card
// (stats baked in) and the hosted page (stats decoded from the URL fragment).
function page(bootstrap, title) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style id="aw-style">${CSS}</style></head>
<body>
  <div class="bar">
    <div class="themes">${THEME_BUTTONS}</div>
    <div class="acts">
      <button class="btn" id="dl">⬇ Download PNG</button>
      <button class="btn ghost" id="sx">Share on X</button>
    </div>
    <span class="hint">Pick a theme · 100% local · nothing uploaded</span>
  </div>
  <div id="stage"><div id="card" data-theme="dark"></div></div>
<script>${CLIENT}</script>
<script>${bootstrap}</script>
</body></html>`;
}

// Local card: stats are embedded directly. Opens straight from disk, offline.
export function renderCard(stats, opts = {}) {
  const handle = opts.handle || "@geartbuilds";
  const boot = `AgentWrapped.render(${JSON.stringify(stats)}, ${JSON.stringify(handle)});`;
  return page(boot, `Agent Wrapped — ${stats.period.label}`);
}

// Optional hosted page (e.g. GitHub Pages): stats arrive in the URL fragment
// (#<base64-json>), which browsers never send to the server — so it stays as
// private as the local card. Falls back to a demo card when there's no data.
export function renderWebPage(demoStats) {
  const boot = `
    function decodeStats(){
      try {
        var raw = location.hash.replace(/^#/, "");
        if (!raw) return null;
        var json = decodeURIComponent(escape(atob(raw)));
        return JSON.parse(json);
      } catch (e) { return null; }
    }
    var s = decodeStats() || ${JSON.stringify(demoStats)};
    AgentWrapped.render(s, s.handle || "@geartbuilds");
  `;
  return page(boot, "Agent Wrapped");
}
