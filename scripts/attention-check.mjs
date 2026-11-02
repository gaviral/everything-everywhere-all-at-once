// No extra dependencies: run with `node scripts/attention-check.mjs`.
// Checks the attention guide's rules (ui/src/attention-core.ts): timings from reading, what counts as an unseen
// change, where marks go after a merge, the "latest" mark, and which spoken words point at "this".
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { readMs, LOOK_MS, READ_WPM, changes, carry, newestOwn, newestSaid, pointsAtThis, direction } = await server.ssrLoadModule("/src/attention-core.ts");

  // Reading time: one look over, then the words at 238 a minute. Never a fixed clock.
  assert.equal(readMs(""), LOOK_MS);
  assert.equal(readMs("Rent Due Friday Rent is due Friday, not sent yet"), LOOK_MS + Math.round((10 * 60_000) / READ_WPM));
  assert.ok(readMs("one two three") < readMs("one two three four five six seven eight"), "longer words, longer look");

  const thought = (id, thread_id, speaker = "User", extra = {}) => ({ id, thread_id, speaker, text: id, point: `p ${id}`, placed: !!thread_id,
    complete: true, unclear: "", at_ms: 1, place_ms: 10, ...extra });
  const thread = (id, title = id) => ({ id, title, parent_id: null, status: "open", tags: [], picture: null });
  const world = (extra) => ({ threads: [thread("T1"), thread("T2")], thoughts: [], suggestions: [], actions: [], merged: {}, active: "T1", active_by: {}, ...extra });

  // Your own words landing aren't "unseen": they get the landing's highlight and the latest mark.
  const before = world({ thoughts: [thought("a", "T1")] });
  assert.deepEqual(changes(before, world({ thoughts: [thought("a", "T1"), thought("b", "T2")] }), "User"), []);
  // Someone else's thought in a room is.
  assert.deepEqual(changes(before, world({ thoughts: [thought("a", "T1"), thought("b", "T2", "Sam")] }), "User"),
    [{ thread: "T2", element: "point-b", line: "p b" }]);
  // A new proposal or suggestion, and a new title (the AI tidied it), are.
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, suggestions: [{ id: "s", thread_id: "T1", text: "Call the landlord", status: "new" }] }), "User"),
    [{ thread: "T1", element: "item-s", line: "Call the landlord" }]);
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, actions: [{ id: "x", thread_id: "T2", title: "Pay rent", status: "new" }] }), "User"),
    [{ thread: "T2", element: "item-x", line: "Pay rent" }]);
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, threads: [thread("T1", "Rent Due Friday"), thread("T2")] }), "User"),
    [{ thread: "T1", element: "title-T1", line: "Rent Due Friday" }]);
  // A kept or dismissed item isn't new.
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, suggestions: [{ id: "s", thread_id: "T1", text: "x", status: "kept" }] }), "User"), []);
  // A merge moves your thought into another thread: that thread changed.
  const merged = world({ threads: [thread("T2")], merged: { T1: "T2" }, thoughts: [thought("a", "T2")] });
  assert.deepEqual(changes(before, merged, "User"), [{ thread: "T2", element: "point-a", line: "p a" }]);
  // A mark follows its thread into the merge, and goes with a thread that's gone.
  assert.deepEqual(carry([{ thread: "T1", element: "point-a", line: "x" }], merged), [{ thread: "T2", element: "point-a", line: "x" }]);
  // A new title's mark points at the joined thread's title: the old title's card is gone, so it could never be read.
  assert.deepEqual(carry([{ thread: "T1", element: "title-T1", line: "x" }], merged), [{ thread: "T2", element: "title-T2", line: "T2" }]);
  assert.deepEqual(carry([{ thread: "T9", element: "title-T9", line: "x" }], merged), []);

  // "Latest" moves to your newest landing only; someone else's leaves it where it was.
  assert.equal(newestOwn([thought("a", "T1"), thought("b", "T1"), thought("c", "T2", "Sam")], "User"), "b");
  assert.equal(newestOwn([thought("c", "T2", "Sam")], "User"), null);
  // On a page that didn't see them land (fresh, or a reconnect), by when you said them; a sample's future time counts least.
  assert.equal(newestSaid([thought("a", "T1", "User", { at_ms: 5 }), thought("b", "T1", "User", { at_ms: 9 }), thought("c", "T1", "Sam", { at_ms: 20 })], "User", 100), "b");
  assert.equal(newestSaid([thought("a", "T1", "User", { at_ms: 5 }), thought("s", "T1", "User", { at_ms: 500 })], "User", 100), "a");
  assert.equal(newestSaid([thought("c", "T1", "Sam")], "User", 100), null);

  // "This": only a whole command the core acts on the thread you're on with (spoken.rs `unfold`, main.rs focus).
  for (const said of ["Collapse this", "expand this one", "Okay, collapse that thread.", "focus on this", "Um, so, can you unfold it please?",
    "Let's collapse this card", "Collapse it all", "Focus on this thread"])
    assert.ok(pointsAtThis(said), said);
  // Not: talk with "this" in it; a named thread that starts with "this" (the core folds "This weekend"); "open", "show",
  // "hide", "close" and "fold" with "this", which the core leaves as thoughts; a verb the core has no command for.
  for (const said of ["Okay, this is actually working! This is so exciting", "Rent is due Friday", "Show me the garden", "this weekend I'll fix it",
    "It's due Friday", "collapse this weekend", "Expand this thread about rent", "Hide it", "Let's open this card", "move this thread up", "Collapse", "Let's focus on this"])
    assert.ok(!pointsAtThis(said), said);

  // Which way to look for a held-back landing.
  const band = { top: 100, bottom: 700 };
  assert.equal(direction({ top: 800, bottom: 830 }, band), "↓");
  assert.equal(direction({ top: 20, bottom: 90 }, band), "↑");
  assert.equal(direction({ top: 300, bottom: 330 }, band), null);
  console.log("attention-check: ok");
} finally {
  await server.close();
}
