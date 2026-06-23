import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Stream a JSONL transcript line by line, invoking onEvent for each parsed
// object. Malformed lines are skipped silently — transcripts can contain
// partial writes and version drift, and one bad line must never crash a run.
export async function streamTranscript(path, onEvent) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    onEvent(obj);
  }
}

// Count the lines a tool_use authored. Generous by design: this is the
// "code your agent wrote" stat, so we count produced lines, not net diff.
export function linesAuthored(toolUse) {
  if (!toolUse || toolUse.type !== "tool_use") return 0;
  const name = toolUse.name;
  const input = toolUse.input || {};
  const count = (s) => (typeof s === "string" && s.length ? s.split("\n").length : 0);

  if (name === "Write") return count(input.content);
  if (name === "Edit") return count(input.new_string);
  if (name === "NotebookEdit") return count(input.new_source);
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.reduce((n, e) => n + count(e && e.new_string), 0);
  }
  return 0;
}

// File path a tool_use touched (for the "most-edited file" stat).
export function filePathOf(toolUse) {
  const input = (toolUse && toolUse.input) || {};
  return input.file_path || input.notebook_path || null;
}
