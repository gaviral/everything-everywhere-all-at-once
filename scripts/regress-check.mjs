// No extra dependencies: run with `node scripts/regress-check.mjs`.
// Regressions where the day's branches met (Nov 1 hunt), on the window's side: each case failed before its fix.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const ui = (path) => readFileSync(new URL(`../ui/src/${path}`, import.meta.url), "utf8");
const server = await uiServer();
try {
  const { deletesPoint } = await server.ssrLoadModule("/src/Moves.tsx");
  const { typingIn } = await server.ssrLoadModule("/src/find.ts");
  const { landedNow } = await server.ssrLoadModule("/src/landed.ts");
  const { whysAfter } = await server.ssrLoadModule("/src/whyhere.tsx");
  const { mapMarkdown } = await server.ssrLoadModule("/src/export-md.ts");

  // Holding Backspace on a point: the first press deletes it, the repeats delete nothing (Undo brings back one).
  const key = (extra = {}) => ({ key: "Backspace", repeat: false, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, ...extra });
  assert.equal(deletesPoint(key()), true);
  assert.equal(deletesPoint(key({ key: "Delete" })), true);
  assert.equal(deletesPoint(key({ repeat: true })), false, "a held key deletes one point");
  assert.equal(deletesPoint(key({ metaKey: true })), false);
  assert.equal(deletesPoint(key({ key: "a" })), false);

  // A find jump while you type: the point shows, focus stays in the field, so Backspace edits your words.
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(typingIn({ tagName }), true, tagName);
  assert.equal(typingIn({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(typingIn({ tagName: "BODY", isContentEditable: false }), false);
  assert.equal(typingIn(null), false);
  assert.match(ui("find.ts"), /if \(!typingIn\(document\.activeElement\)\) target\.focus/, "the jump asks before taking focus");

  // Undo of a Delete brings the point back as a fresh thought: no landing, so the map doesn't follow it and it
  // doesn't take the "latest" mark; a thought placed for the first time is one.
  const ever = new Set();
  const ids = (list) => list.map((t) => t.id);
  assert.deepEqual(ids(landedNow([{ id: "a" }, { id: "b" }], new Set(), ever)), ["a", "b"]);
  assert.deepEqual(ids(landedNow([{ id: "b" }], new Set(["a", "b"]), ever)), [], "a deleted");
  assert.deepEqual(ids(landedNow([{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["b"]), ever)), ["c"], "a came back by Undo; c landed");
  for (const file of ["App.tsx", "Attention.tsx"]) assert.match(ui(file), /landedNow\(/, `${file} follows and marks only landings`);

  // A merge changes which thread a point is on: a kept "started this thread" is asked again; an ask still out stays.
  const whys = { a: { text: "Why here: started this thread", failed: false }, b: { text: "", failed: false, pending: true } };
  for (const type of ["thread_merged", "thread_unmerged"]) {
    assert.deepEqual(Object.keys(whysAfter(whys, { type: "change", change: { type, from: "T2", into: "T1" } })), ["b"], type);
  }
  assert.equal(whysAfter(whys, { type: "change", change: { type: "thread_touched" } }), whys);

  // The export bolds as decided only what the card marks: the core's mark, not its own reading of the words.
  const base = { recaps: [], apps: [], apps_seeded: false, merged: {}, proposals: [], suggestions: [], actions: [], active: null, active_by: {}, notes: {} };
  const thread = { id: "T1", title: "Trip", parent_id: null, status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" };
  const thought = (decided) => ({ id: "x", speaker: "you", text: "Once we chose the hotel, book the train", point: "Once we chose the hotel, book the train", thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: 0, place_ms: null, ...(decided === undefined ? {} : { decided }) });
  const md = (t) => mapMarkdown({ ...base, threads: [thread], thoughts: [t] }, { now: 0, timeZone: "UTC" }).text;
  assert.doesNotMatch(md(thought(false)), /Decided/, "the card doesn't mark it, so neither does the export");
  assert.match(md(thought(true)), /\*\*Decided:\*\* /);
  assert.match(md(thought(undefined)), /\*\*Decided:\*\* /, "a thought from before the mark: its words are read");

  // The install hint is a dock card, so the map's follow keeps landings clear of it.
  assert.match(ui("Install.tsx"), /className="install-hint"[^>]*data-dock-card/);

  console.log("regress-check: OK");
} finally {
  await server.close();
}
