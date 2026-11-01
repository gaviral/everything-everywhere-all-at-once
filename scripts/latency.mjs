#!/usr/bin/env node
// How long placing took, from a journal: the source for the "2 to 4 s" in the README.
// Usage: node scripts/latency.mjs data/journal.jsonl
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/latency.mjs JOURNAL.jsonl");
  process.exit(1);
}
const times = readFileSync(file, "utf8").split("\n").flatMap((line) => {
  try {
    const change = JSON.parse(line);
    return change.type === "thought_placed" && Number.isFinite(change.place_ms) ? [change.place_ms] : [];
  } catch {
    return [];
  }
}).sort((a, b) => a - b);
if (!times.length) {
  console.log("No placements with a time in this journal.");
  process.exit(0);
}
const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(`${times.length} placements: median ${s(at(0.5))}, 90% within ${s(at(0.9))}, slowest ${s(times.at(-1))}`);
