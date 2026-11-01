// No extra dependencies: run with `node scripts/away-check.mjs`.
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { awayItems, AWAY_AFTER_MS } = await server.ssrLoadModule("/src/Away.tsx");
  const thread = (id, extra = {}) => ({ id, title: id, parent_id: null, status: "open", last_point: "", touched_ms: 100,
    tags: [], picture: null, dropped_by: "", ...extra });
  const thought = (id, thread_id, at_ms, extra = {}) => ({ id, thread_id, at_ms, speaker: "User", text: id, point: id,
    placed: true, complete: true, unclear: "", place_ms: 10, ...extra });
  const base = { threads: [thread("old"), thread("unfinished")], thoughts: [thought("seen", "old", 1), thought("start", "unfinished", 2, { complete: false })],
    suggestions: [], actions: [], merged: {}, active: "old", active_by: { User: "old" }, recaps: [], apps: [], apps_seeded: true };
  const after = { ...base, threads: [thread("old"), thread("unfinished", { status: "dropped", dropped_by: "User" }), thread("fresh"), thread("Sam's")],
    thoughts: [...base.thoughts, thought("more", "old", 10), thought("newest", "fresh", 20), thought("other", "Sam's", 30, { speaker: "Sam" })],
    suggestions: [{ id: "idea", thread_id: "fresh", text: "Try this", status: "new" }, { id: "theirs", thread_id: "Sam's", text: "Their idea", status: "new" }],
    actions: [{ id: "task", thread_id: "old", title: "Call", kind: "reminder", when: "", status: "new", done_ms: null }] };
  const stamps = new Map([["more", 100], ["newest", 200], ["idea", 300], ["task", 400], ["dropped:unfinished", 150]]);
  const rows = awayItems(base, after, "User", stamps);
  assert.equal(AWAY_AFTER_MS, 30_000);
  assert.deepEqual(rows.map((r) => r.key), ["thread:fresh", "proposal:idea", "thread:unfinished", "thread:old", "proposal:task"]);
  assert.match(rows.find((r) => r.threadId === "fresh" && r.kind === "thread").detail, /^New thread/);
  assert.match(rows.find((r) => r.key === "thread:old").detail, /^1 new point/);
  assert.match(rows.find((r) => r.key === "thread:unfinished").detail, /^Left unfinished/);
  assert.equal(rows[rows.findIndex((r) => r.key === "thread:old") + 1].itemId, "task", "a proposal follows its thread");
  assert.deepEqual(awayItems(base, base, "User"), []);
  assert.deepEqual(awayItems(base, { ...base, suggestions: after.suggestions }, "User"), []);
  assert.equal(awayItems(base, after, "Sam").length, 2);
  assert.deepEqual(awayItems(base, after, "Nobody"), []);
  const done = { ...after, suggestions: after.suggestions.map((s) => ({ ...s, status: "dismissed" })), actions: after.actions.map((a) => ({ ...a, status: "done" })) };
  assert.ok(awayItems(base, done, "User").every((r) => r.kind !== "proposal"));
  const merged = { ...after, merged: { old: "fresh" }, threads: after.threads.filter((t) => t.id !== "old"),
    thoughts: after.thoughts.map((t) => t.thread_id === "old" ? { ...t, thread_id: "fresh" } : t) };
  const mergedRow = awayItems(base, merged, "User").find((r) => r.key === "thread:fresh");
  assert.match(mergedRow.detail, /^2 new points/);
  assert.ok(awayItems(base, merged, "User").every((r) => r.threadId !== "old"));
  const pending = { ...base, thoughts: [...base.thoughts, thought("pending", "old", 3, { placed: false })] };
  const landed = { ...pending, thoughts: pending.thoughts.map((t) => ({ ...t, placed: true })) };
  assert.match(awayItems(pending, landed, "User")[0].detail, /^1 new point/);
  const tied = awayItems(base, after, "User", new Map([["more", 500], ["newest", 500]]))
    .filter((r) => r.key === "thread:old" || r.key === "thread:fresh");
  assert.deepEqual(tied.map((r) => r.key), ["thread:fresh", "thread:old"], "batched arrivals keep the newest words first");
  const incomplete = { ...base, thoughts: [...base.thoughts, thought("trail", "old", 40, { complete: false })] };
  assert.equal(awayItems(base, incomplete, "User").length, 1, "unfinished and updated are one row");
  assert.equal(awayItems(base, incomplete, "User")[0].unfinished, true);
  const alreadyDropped = { ...base, threads: base.threads.map((t) => t.id === "unfinished" ? { ...t, status: "dropped", dropped_by: "User" } : t) };
  assert.ok(!awayItems(alreadyDropped, after, "User").some((r) => r.key === "thread:unfinished"), "old unfinished threads don't repeat");
  const oldProposal = { ...base, suggestions: [after.suggestions[0]] };
  assert.ok(!awayItems(oldProposal, after, "User").some((r) => r.key === "proposal:idea"));
  console.log("Away map checks passed: new/updated threads, newest first, proposals, unfinished, room speakers, quiet returns, pending placement, merges, decisions.");
} finally {
  await server.close();
}
