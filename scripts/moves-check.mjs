// No extra dependencies: run with `node scripts/moves-check.mjs`.
// Move and rename in the window (ui/src/moves-core.ts, Moves.tsx): a move lands as the core applies it, settles a
// merge card between the two threads, follows a merge, and its undo goes back; the Move list narrows and orders as
// Things' does; a typed title sends only a real change; and the map's points and titles carry the controls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const { moveTargets, typedTitle } = await server.ssrLoadModule("/src/moves-core.ts");

  const thread = (id, title, touched_ms) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms, tags: [], picture: null, dropped_by: "" });
  const thought = (id, thread_id) => ({ id, speaker: "you", text: id, point: id, thread_id, placed: true, unclear: "", complete: true, at_ms: 0, place_ms: 1000 });
  const world = {
    recaps: [], apps: [], apps_seeded: false, merged: {}, notes: {}, suggestions: [], actions: [],
    threads: [thread("T1", "Garden", 1), thread("T2", "Pottery class", 3), thread("T3", "Bills", 2)],
    thoughts: [thought("a", "T1"), thought("w", "T1"), thought("b", "T2")],
    active: "T1", active_by: { you: "T1" },
    proposals: [{ id: "p", kind: "merge", thread_id: "T2", into: "T1", status: "new" }, { id: "q", kind: "merge", thread_id: "T3", into: "T1", status: "new" }],
  };
  const on = (w, id) => w.thoughts.find((t) => t.id === id).thread_id;

  // A move lands where the person put it, and a merge card between the two threads is past; another card stays.
  const moved = apply(world, { type: "thought_moved", thought_id: "w", thread_id: "T2", from: "T1" });
  assert.equal(on(moved, "w"), "T2");
  assert.deepEqual(moved.proposals.map((p) => p.status), ["done", "new"]);
  // Its undo goes back and asks nothing again; the core's field may be absent (false is never sent).
  const undone = apply(moved, { type: "thought_moved", thought_id: "w", thread_id: "T1", from: "T2", undo: true });
  assert.equal(on(undone, "w"), "T1");
  assert.deepEqual(undone.proposals.map((p) => p.status), ["done", "new"]);
  // To a thread merged away since: where it went. To a thread not on the map, or a thought gone: nothing.
  const merged = apply(world, { type: "thread_merged", from: "T3", into: "T2" });
  assert.equal(on(apply(merged, { type: "thought_moved", thought_id: "a", thread_id: "T3", from: "T1" }), "a"), "T2");
  assert.equal(apply(world, { type: "thought_moved", thought_id: "a", thread_id: "T9", from: "T1" }), world);
  assert.equal(apply(world, { type: "thought_moved", thought_id: "zz", thread_id: "T2", from: "T1" }), world);

  // The Move list: every other thread, touched last first; typing narrows by the start of each word.
  const ids = (list) => list.map((t) => t.id);
  assert.deepEqual(ids(moveTargets(world.threads, "T1", "")), ["T2", "T3"]);
  assert.deepEqual(ids(moveTargets(world.threads, "T1", "pot")), ["T2"]);
  assert.deepEqual(ids(moveTargets(world.threads, "T1", "cl pot")), ["T2"], "any order, each word a start");
  assert.deepEqual(ids(moveTargets(world.threads, "T1", "ottery")), [], "not the middle of a word");
  assert.deepEqual(ids(moveTargets(world.threads, null, "")), ["T2", "T3", "T1"]);

  // A typed title: trimmed and spaced; empty or unchanged sends nothing.
  assert.equal(typedTitle("  Kiln   days ", "Pottery class"), "Kiln days");
  assert.equal(typedTitle("   ", "Pottery class"), null);
  assert.equal(typedTitle("Pottery class ", "Pottery class"), null);

  // The map wires them: every point has a Move, every card title renames, every card takes a dropped point, and the
  // help list says both.
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<MovePoint thought=\{thought\} \/>/);
  assert.match(app, /<ThreadTitle thread=\{thread\} depth=\{depth\} \/>/);
  assert.match(app, /useDropPoint\(thread\.id\)[\s\S]*\{\.\.\.drop\.props\}/);
  assert.match(app, /<MovesProvider threads=\{world\.threads\} move=\{core\.move\} rename=\{core\.rename\} remove=\{core\.remove\}>/);
  assert.match(app, /“Move that to \[thread\]”[^<]*“Rename this to \[title\]”/);
  // On a phone Move shows once a tap focuses its point, so every point takes focus, an imported one (no placement
  // time) too, without becoming a Tab stop of its own.
  const css = readFileSync(new URL("../ui/src/moves.css", import.meta.url), "utf8");
  assert.match(css, /@media \(hover: none\)[\s\S]*\.points li:not\(:focus-within\) \.move-button/);
  const li = app.match(/<motion\.li id=\{`point-[^\n]*/)[0];
  assert.match(li, /tabIndex=\{thought\.place_ms != null \? 0 : -1\}/, "every point focusable by a tap");
  // Enter or Esc in a title's field gives focus back to the title, so Enter edits it again and j/k go on from there.
  const moves = readFileSync(new URL("../ui/src/Moves.tsx", import.meta.url), "utf8");
  assert.match(moves, /"Enter"\) \{[^}]*refocus\.current = true/);
  assert.match(moves, /"Escape"\) \{[^}]*refocus\.current = true/);
  assert.match(moves, /if \(!editing && refocus\.current\) \{[^}]*button\.current\?\.focus\(\)/);
  assert.match(moves, /<button ref=\{button\}[^>]*className="title-button"/);
  const core = readFileSync(new URL("../ui/src/core.ts", import.meta.url), "utf8");
  assert.match(core, /type: "move", thought_id, thread_id/);
  assert.match(core, /type: "rename", thread_id, title/);
  // The same messages the core reads (protocol.rs ClientMsg).
  const protocol = readFileSync(new URL("../core/src/protocol.rs", import.meta.url), "utf8");
  assert.match(protocol, /Move \{\s*thought_id: String,[\s\S]*?thread_id: Option<String>,\s*\}/);
  assert.match(protocol, /Rename \{ thread_id: String, title: String \}/);

  // Delete: every point's Delete (in Move's span, so it shows when Move does) and the Delete key on a focused point
  // send the message the core reads, and "delete this" knows the point you're on (this-card.ts `pointOf`).
  assert.match(moves, /className="move-button delete-button" aria-label=\{`Delete “\$\{thought\.point\}”`\}/);
  assert.match(moves, /event\.key !== "Delete" && event\.key !== "Backspace"[\s\S]*matches\("li\[id\^='point-'\]"\)[\s\S]*remove\(point\.id\.slice/);
  assert.match(core, /type: "delete", thought_id/);
  assert.match(protocol, /Delete \{ thought_id: String \}/);
  assert.match(app, /“Delete this”/);
  // Undo puts a thread and a point back where they stood, as the core does (world.rs `PutBack`); either gone, nothing.
  const off = apply(apply(world, { type: "thought_skipped", thought_id: "b" }), { type: "thread_removed", thread_id: "T2" });
  const back = [{ type: "thread_added", thread: world.threads[1] }, { type: "thought_added", thought: world.thoughts[2] },
    { type: "put_back", id: "T2", before: "T3" }].reduce(apply, off);
  assert.deepEqual(back.threads.map((t) => t.id), ["T1", "T2", "T3"]);
  const first = [{ type: "thought_skipped", thought_id: "a" }, { type: "thought_added", thought: world.thoughts[0] },
    { type: "put_back", id: "a", before: "w" }].reduce(apply, world);
  assert.deepEqual(first.thoughts.map((t) => t.id), ["a", "w", "b"]);
  assert.equal(apply(world, { type: "put_back", id: "a", before: "gone" }).thoughts, world.thoughts);
  assert.equal(apply(world, { type: "put_back", id: "a", before: "a" }).thoughts, world.thoughts);
  const { pointOf, watchAttention, attentionTeller } = await server.ssrLoadModule("/src/this-card.ts");
  const li2 = (id) => ({ closest: (s) => (s.startsWith("li") ? { id } : null) });
  assert.equal(pointOf(li2("point-th-1")), "th-1");
  assert.equal(pointOf(li2("thread-T1")), null, "a card is no point");
  assert.equal(pointOf(null), null);
  const handlers = {};
  const page = { getSelection: () => ({ isCollapsed: true }), activeElement: null, body: {}, addEventListener: (t, f) => { handlers[t] = f; },
    removeEventListener: () => {}, documentElement: { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: () => {} } };
  const told = [];
  const stop = watchAttention((...a) => told.push(a), page);
  handlers.pointerover({ target: li2("point-th-1") });
  handlers.pointerover({ target: li2("point-th-2") });
  handlers.pointerleave();
  stop();
  assert.deepEqual(told.map((a) => a[2]), ["th-1", "th-2", null], "each point the pointer is on, then none");
  const teller = attentionTeller();
  const sent = [];
  teller.tell(null, "T1", (m) => sent.push(JSON.parse(m)), "th-1");
  teller.tell(null, "T1", (m) => sent.push(JSON.parse(m)));
  assert.deepEqual(sent, [{ type: "attention", selected: null, pointed: "T1", point: "th-1" }, { type: "attention", selected: null, pointed: "T1" }]);
  console.log("moves-check: ok");
} finally {
  await server.close();
}
