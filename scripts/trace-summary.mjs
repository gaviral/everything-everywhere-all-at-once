#!/usr/bin/env node
// Which Meta model did what, read from a trace (a core started with E2A2O_TRACE=1 writes data/<map>/trace.jsonl):
// one row per feature with its model, how many calls, and how long they took; then the voice turns heard, the
// placements and the pictures saved. With --excerpt, one call per feature, shortened for reading: what was sent
// becomes its size and the last message's first words; the answer keeps its first characters.
//   node scripts/trace-summary.mjs data/<map>/trace.jsonl [--excerpt]
// Reads the file only. docs/trace.md was made with it from one take of the demo talk.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** How many characters of a message or answer an excerpt keeps: about two lines on a GitHub page. */
export const KEEP = 240;

export function parse(text) {
  return text.split("\n").filter((l) => l.trim()).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

// Calls sent without a prompt cache key (the composer, Search-first, an app's own prompt) are traced as "other";
// their fixed instructions' first words (core/src/apps.rs) tell them apart.
const UNKEYED = [["Compose a small app", "composer"], ["Search the existing apps", "search-first"], ["Look at the newest thought", "app prompt"]];

/** The feature a call served: its traced name, or for an unkeyed call, the one its instructions begin with. */
export function feature(line) {
  if (line.feature !== "other" || !Array.isArray(line.sent)) return line.feature;
  const first = typeof line.sent[0]?.content === "string" ? line.sent[0].content : "";
  return UNKEYED.find(([start]) => first.startsWith(start))?.[1] ?? "other";
}

/** The middle value; with an even count, halfway between the two middle ones. */
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** One row per feature and model: calls, failed calls, median and slowest ms. In the order each first ran. */
export function summary(lines) {
  const rows = new Map();
  for (const l of lines.filter((l) => l.kind === "call")) {
    const key = `${feature(l)}\u0000${l.model}`;
    const row = rows.get(key) ?? { feature: feature(l), model: l.model, calls: 0, failed: 0, ms: [] };
    row.calls += 1;
    if (l.error) row.failed += 1;
    else row.ms.push(l.ms);
    rows.set(key, row);
  }
  return {
    calls: [...rows.values()].map(({ ms, ...r }) => ({ ...r, median_ms: median(ms), slowest_ms: ms.length ? Math.max(...ms) : null })),
    heard: lines.filter((l) => l.kind === "heard").length,
    placements: lines.filter((l) => l.kind === "placed").length,
    pictures: lines.filter((l) => l.kind === "picture").length,
  };
}

const cut = (text, n = KEEP) => {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** A call shortened for reading: never the whole prompt, which carries the map. */
export function shorten(line) {
  const sent = Array.isArray(line.sent) ? line.sent : [{ role: "prompt", content: line.sent }];
  const text = (m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""));
  const last = sent[sent.length - 1];
  const out = {
    feature: feature(line),
    model: line.model,
    ms: line.ms,
    sent: { messages: sent.length, characters: sent.reduce((n, m) => n + text(m).length, 0), last: cut(text(last)) },
  };
  if (line.error) out.error = cut(line.error);
  else out.answer = typeof line.answer === "object" && line.answer !== null && "images" in line.answer ? line.answer : cut(line.answer);
  if (line.usage) out.usage = line.usage;
  return out;
}

/** The first answered call of each feature and model, shortened. */
export function excerpt(lines) {
  const seen = new Set();
  return lines.filter((l) => l.kind === "call" && !l.error).filter((l) => {
    const key = `${feature(l)}\u0000${l.model}`;
    return !seen.has(key) && seen.add(key);
  }).map(shorten);
}

export function table({ calls, heard, placements, pictures }) {
  const out = ["| Feature | Model | Calls | Median | Slowest |", "|---|---|---|---|---|"];
  for (const r of calls) {
    const fail = r.failed ? ` (${r.failed} failed)` : "";
    const s = (ms) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);
    out.push(`| ${r.feature} | ${r.model} | ${r.calls}${fail} | ${s(r.median_ms)} | ${s(r.slowest_ms)} |`);
  }
  out.push("", `Voice turns heard: ${heard}. Placements: ${placements}. Pictures saved: ${pictures}.`);
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node scripts/trace-summary.mjs data/<map>/trace.jsonl [--excerpt]");
    process.exit(2);
  }
  const lines = parse(readFileSync(file, "utf8"));
  console.log(table(summary(lines)));
  if (flags.includes("--excerpt")) for (const l of excerpt(lines)) console.log(`\n${JSON.stringify(l)}`);
}
