// Emits web/index.html — the deployable page for geartferhati.com/wrapped.
// It reads stats from the URL fragment (#<base64-json>) the CLI produces, and
// falls back to a demo card when visited with no data. Run: npm run build:web
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderWebPage } from "../src/card.js";
import { DEMO } from "./demo-stats.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "web");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "index.html");
writeFileSync(outFile, renderWebPage(DEMO), "utf8");
console.log("Wrote " + outFile);
