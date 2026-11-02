// No extra dependencies: run with `node scripts/placing-check.mjs`.
// Checks what a pending thought's pill says, and that a late landing of yours doesn't move the map.
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

// room.tsx reads the page's address as it loads: this is the app opened alone.
globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { pendingLabel, landingToFollow } = await server.ssrLoadModule("/src/core.ts");
  const thought = (id, thread_id, at_ms, extra = {}) => ({ id, thread_id, at_ms, speaker: "User", text: id, point: id,
    placed: !!thread_id, complete: true, unclear: "", place_ms: 10, ...extra });

  // The pill: "Finding a thread" only while its own call runs.
  const said = thought("b", null, 0);
  const idle = { now: null, retryAt: {} };
  assert.equal(pendingLabel(said, { now: "b", retryAt: {} }, 3_000, false, false), "Finding a thread");
  assert.equal(pendingLabel(said, { now: "b", retryAt: {} }, 9_000, false, false), "Finding a thread · 9s");
  assert.equal(pendingLabel(said, { now: "a", retryAt: {} }, 9_000, false, false), "Waiting · 9s");
  // A busy service holds the whole line: no call runs, a's retry waits, and b waits behind it.
  const busy = { now: null, retryAt: { a: 40_000 } };
  assert.equal(pendingLabel(said, busy, 9_000, false, false), "Waiting · 9s");
  assert.equal(pendingLabel(thought("a", null, 0), busy, 9_000, false, false), "Couldn't place yet · retrying in 31s");
  assert.equal(pendingLabel(thought("a", null, 0), busy, 39_500, false, false), "Couldn't place yet · retrying");
  assert.equal(pendingLabel(said, idle, 1_000, false, false), "Waiting");
  assert.equal(pendingLabel(said, idle, 1_000, true, false), "Needs the AI key");
  assert.equal(pendingLabel(said, idle, 1_000, false, true), "Waiting for a working key");

  // A failed; newer B landed on T2, so User is on T2. A lands on T1 at last and doesn't move him: not followed.
  const threads = ["T1", "T2", "T3"].map((id) => ({ id, title: id }));
  const before = { threads, active: "T2", active_by: { User: "T2" },
    thoughts: [thought("A", null, 1), thought("B", "T2", 2)] };
  const late = { ...before, thoughts: [thought("A", "T1", 1), thought("B", "T2", 2)] };
  const retried = new Set(["A"]);
  let out = landingToFollow(late, [late.thoughts[0]], "User", false, retried, null);
  assert.equal(out.landing, null, "a late landing isn't followed");
  assert.deepEqual(out.held, { thread: "T1", thought: "A", mine: true });
  // If the next message moves him to it after all (its move arrived separately), that's followed with the thought.
  const movedThere = { ...late, active: "T1", active_by: { User: "T1" } };
  assert.deepEqual(landingToFollow(movedThere, [], "User", true, retried, out.held).landing, out.held);
  // A move elsewhere doesn't pick it up.
  assert.equal(landingToFollow({ ...late, active: "T3" }, [], "User", true, retried, out.held).landing, null);
  // Never failed: followed as ever, also when his place stayed ("…, where was I?" in the same breath).
  assert.deepEqual(landingToFollow(late, [late.thoughts[0]], "User", false, new Set(), null).landing, { thread: "T1", thought: "A", mine: true });
  // Late, but on the thread he's on, or with his place moving in the same message: followed.
  const onIt = { ...late, active: "T1" };
  assert.deepEqual(landingToFollow(onIt, [late.thoughts[0]], "User", false, retried, null).landing.thought, "A");
  assert.deepEqual(landingToFollow(late, [late.thoughts[0]], "User", true, retried, null).landing.thought, "A");
  // Someone else's retry is theirs: their landing is followed as any other's (only your own moves your view).
  const sams = { ...late, thoughts: [thought("A", "T1", 1, { speaker: "Sam" }), late.thoughts[1]] };
  assert.equal(landingToFollow(sams, [sams.thoughts[0]], "User", false, retried, null).landing.mine, false);
  // A fresh landing of his in the same message is still followed, whichever came first in the list.
  const both = { ...late, active: "T3", thoughts: [...late.thoughts, thought("C", "T3", 3)] };
  out = landingToFollow(both, [both.thoughts[0], both.thoughts[2]], "User", false, retried, null);
  assert.equal(out.landing.thought, "C");
  // A late thought cut in two: its rest (same speaker, same time, right after it) lands just as late.
  const cut = { ...late, thoughts: [thought("A", "T1", 1), thought("A2", null, 1), thought("B", "T2", 2)] };
  const tries = new Set(["A"]);
  landingToFollow(cut, [cut.thoughts[0]], "User", false, tries, null);
  assert.ok(tries.has("A2"));
  const restLanded = { ...cut, thoughts: [cut.thoughts[0], thought("A2", "T3", 1), cut.thoughts[2]] };
  assert.equal(landingToFollow(restLanded, [restLanded.thoughts[1]], "User", false, tries, null).landing, null);
  console.log("placing-check: ok");
} finally {
  await server.close();
}
