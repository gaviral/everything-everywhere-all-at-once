// No extra dependencies: run with `node scripts/recap-check.mjs`.
// Which messages close an open Recap (`movesAsked` in ui/src/core.ts): fed one at a time, each with the map as it
// was before it, the way a window gets them from the core.
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

// room.tsx reads the page's address as it loads: this is the app opened alone.
globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { movesAsked, apply } = await server.ssrLoadModule("/src/core.ts");
  const thread = (id) => ({ id, title: `Topic ${id}`, parent_id: null, status: "open", last_point: "", touched_ms: 1,
    tags: [], picture: null, dropped_by: "" });
  const thought = (id, thread_id, extra = {}) => ({ id, speaker: "you", text: id, point: id, thread_id, placed: !!thread_id,
    unclear: "", complete: true, at_ms: 1, place_ms: null, ...extra });
  const map = { threads: ["T1", "T2", "T3"].map(thread), thoughts: [thought("said", "T1")], active: "T1", active_by: { you: "T1" },
    recaps: [], suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true };
  // One window of `speaker`, fed in order: which messages close the sheet.
  const closes = (messages, world = map, speaker = "you") => {
    const asked = movesAsked(speaker);
    return messages.map((msg) => {
      const close = asked(world, msg);
      if (msg.type === "change") world = apply(world, msg.change);
      return close;
    });
  };
  const change = (c) => ({ type: "change", change: c });
  const moved = (thread_id, speaker = "you") => change({ type: "active_changed", thread_id, speaker });
  const said = (id, speaker = "you") => change({ type: "thought_added", thought: thought(id, null, { speaker }) });
  const placed = (thought_id, thread_id) => change({ type: "thought_placed", thought_id, thread_id, point: thought_id, unclear: "",
    complete: true, place_ms: 2500 });
  const touched = (thread_id) => change({ type: "thread_touched", thread_id, last_point: "", at_ms: 2 });
  const dropped = (thread_id) => change({ type: "thread_status", thread_id, status: "dropped", speaker: "you" });
  const notice = (message) => ({ type: "notice", message });

  // Asked for: each closes it.
  assert.deepEqual(closes([{ type: "view", view: "palace" }]), [true], "“palace”");
  assert.deepEqual(closes([moved("T3"), { type: "found", thread_id: "T3", thought_id: null, message: "Here: Topic T3" }]), [true, true], "a search's jump");
  assert.deepEqual(closes([notice("On to Topic T2"), moved("T2")]), [false, true], "“next one”");
  assert.deepEqual(closes([notice("Previous: Topic T3"), moved("T3")]), [false, true], "“last one”");
  // "Where was I?" can answer with the thread you're on, right after your words landed there: its notice is the answer.
  assert.deepEqual(closes([said("again"), placed("again", "T1"), touched("T1"), notice("Back to Topic T1"), moved("T1")]),
    [false, false, false, false, true], "“…, where was I?” back to where you are");
  assert.deepEqual(closes([said("on"), placed("on", "T2"), touched("T2"), moved("T2"), notice("Back to Topic T1"), moved("T1")]),
    [false, false, false, false, false, true], "“…, where was I?” after the words moved you");

  // Talk: your words moving you leave it open while you read.
  assert.deepEqual(closes([said("new topic"), placed("new topic", "T2"), touched("T2"), dropped("T1"), moved("T2")]),
    [false, false, false, false, false], "your words landing elsewhere");
  // The placer decides on the map from before the model answered: a click meanwhile doesn't make its move a request.
  assert.deepEqual(closes([said("slow"), moved("T2"), placed("slow", "T2"), touched("T2"), moved("T2")]),
    [false, true, false, false, false], "a landing where you'd already clicked");
  // An import's end opens you on its newest thread when you had no place yet.
  const empty = { ...map, thoughts: [], active: null, active_by: {} };
  assert.deepEqual(closes([change({ type: "thought_added", thought: thought("imported", "T2") }), moved("T2")], empty),
    [false, false], "an import finishing");
  assert.deepEqual(closes([notice("On to Topic T3"), moved("T3")], { ...empty, active: "T2", active_by: { you: "T2" } }),
    [false, true], "once you have a place, “next one” is yours");
  // In a room, someone else's words and moves are theirs.
  assert.deepEqual(closes([said("theirs", "Sam"), placed("theirs", "T3"), touched("T3"), moved("T3", "Sam"), moved("T1", "Sam")]),
    [false, false, false, false, false], "another speaker");
  // Only the rest of the landing's commit counts as it. A landing that didn't move you (you clicked away while it was
  // placed) leaves nothing behind: the next move to that thread is asked for.
  assert.deepEqual(closes([said("x"), placed("x", "T2"), touched("T2"), notice("Back to Topic T2"), moved("T2")]),
    [false, false, false, false, true], "a move asked for after a landing that didn't move you");
  console.log("Recap checks passed: a view, a search's jump, “next one”, “last one” and “where was I?” close it; your words moving you, a landing where you'd clicked meanwhile, an import's end and others' moves don't.");
} finally {
  await server.close();
}
