// No extra dependencies: run with `node scripts/moves-check.mjs`.
// Move and rename in the window (ui/src/moves-core.ts, Moves.tsx): a move lands as the core applies it, settles a
// merge card between the two threads, follows a merge, and its undo goes back; the Move list narrows and orders as
// Things' does; a typed title sends only a real change; and the map's points and titles carry the controls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
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
  assert.match(app, /<MovesProvider threads=\{world\.threads\} move=\{core\.move\} rename=\{core\.rename\}>/);
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
  console.log("moves-check: ok");
} finally {
  await server.close();
}
