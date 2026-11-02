#!/usr/bin/env node
// Where each thought went: one row per thing said, read from a map's journal (and its trace, when the core ran
// with E2A2O_TRACE=1), to check placement by eye or by script.
//   node scripts/where.mjs data/<map> [--json] [--since ISO-or-ms]
// Columns: row, time said, the thread active when it was said (the one selected or last spoken on), the thread
// it landed in then (+ when the placement started it, ✂ when the turn was split there, skip when set aside),
// that thread now (after merges and renames), and the words. With a trace, the model's own answer too.
// Reads files only; never writes. Run it on a copy of someone's map, not the live one.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node scripts/where.mjs DATA_DIR [--json] [--since ISO-or-ms]");
  process.exit(2);
}
const json = flags.includes("--json");
const sinceFlag = flags.indexOf("--since") >= 0 ? flags[flags.indexOf("--since") + 1] : "";
const since = !sinceFlag ? 0 : /^\d+$/.test(sinceFlag) ? Number(sinceFlag) : Date.parse(sinceFlag);

const lines = (file) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
    : [];

const titles = new Map(); // thread id → title now
const merged = new Map(); // old thread id → its successor
const rows = []; // in the order said
const byThought = new Map();
let lastAdded = null; // the thread added just before a placement is the one it started
const resolve = (id) => {
  for (let i = 0; id && merged.has(id) && i <= merged.size; i++) id = merged.get(id);
  return id;
};

for (const c of lines(join(dir, "journal.jsonl"))) {
  switch (c.type) {
    case "thread_added":
      titles.set(c.thread.id, c.thread.title);
      break;
    case "thread_renamed":
    case "thread_retitled":
    case "title_chosen":
      titles.set(c.thread_id, c.title);
      break;
    case "thread_merged":
      merged.set(c.from, c.into);
      break;
    case "thread_unmerged":
      merged.delete(c.unmerge.thread.id);
      break;
    case "thought_added": {
      const t = c.thought;
      const row = { id: t.id, at: t.at_ms, speaker: t.speaker, text: t.text, active: t.thread_id ? resolve(t.thread_id) : null };
      row.activeTitle = row.active ? titles.get(row.active) : null;
      rows.push(row);
      byThought.set(t.id, row);
      break;
    }
    case "thought_split": {
      const row = byThought.get(c.thought_id);
      if (!row) break;
      row.text = c.text;
      row.split = true;
      const rest = { id: c.rest.id, at: c.rest.at_ms, speaker: c.rest.speaker, text: c.rest.text, active: row.active, activeTitle: row.activeTitle, rest: true };
      rows.splice(rows.indexOf(row) + 1, 0, rest);
      byThought.set(rest.id, rest);
      break;
    }
    case "thought_placed": {
      const row = byThought.get(c.thought_id);
      if (!row) break;
      row.landed = c.thread_id;
      row.landedTitle = titles.get(c.thread_id);
      row.point = c.point;
      row.placeMs = c.place_ms;
      break;
    }
    case "thought_skipped": {
      const row = byThought.get(c.thought_id);
      if (row) row.skipped = true;
      break;
    }
  }
  if (c.type === "thread_added") lastAdded = c.thread.id;
  if (c.type === "thought_placed") {
    const row = byThought.get(c.thought_id);
    if (row) row.started = lastAdded === c.thread_id;
    lastAdded = null;
  }
}
for (const t of lines(join(dir, "trace.jsonl"))) {
  if (t.kind !== "placed") continue;
  const row = byThought.get(t.thought);
  if (row) {
    row.answer = t.answer;
    row.activeAtPlace = t.active;
  }
}

const shown = rows.filter((r) => r.at >= since);
for (const r of shown) {
  r.now = r.landed ? resolve(r.landed) : null;
  r.nowTitle = r.now ? titles.get(r.now) : null;
}

if (json) {
  console.log(JSON.stringify(shown, null, 1));
} else {
  const time = (ms) => new Date(ms).toISOString().slice(5, 19).replace("T", " ");
  const thread = (id, title) => (id ? `${id} ${title ?? ""}`.trim() : "-");
  shown.forEach((r, i) => {
    const mark = r.skipped ? "skip" : `${r.started ? "+" : ""}${r.rest ? "✂" : ""}`;
    const now = r.now && r.now !== r.landed ? ` → now ${thread(r.now, r.nowTitle)}` : "";
    const answer = r.answer ? ` [${r.answer.action}${r.answer.thread_id ? " " + r.answer.thread_id : ""}]` : "";
    console.log(
      [String(i + 1).padStart(3), time(r.at), `active: ${thread(r.active, r.activeTitle)}`, `landed: ${mark}${thread(r.landed, r.landedTitle)}${now}${answer}`, r.text]
        .join(" | "),
    );
  });
}
