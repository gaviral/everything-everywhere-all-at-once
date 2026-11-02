// No extra dependencies: run with `node scripts/tidy-check.mjs`.
// The refiner's renames and merges in the window (ui/src/tidy-core.ts): a merge undone puts the map back exactly as
// the core does, an AI rename's note offers Undo, a person's own rename gets no note, and proposals read and wait right.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

globalThis.location = new URL("http://localhost:4321/");

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const { tidyNote, proposalWords, waitingByThread } = await server.ssrLoadModule("/src/tidy-core.ts");
  const { TIPS } = await server.ssrLoadModule("/src/Tips.tsx");

  const thread = (id, parent_id = null) => ({ id, title: `Topic ${id}`, parent_id, status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" });
  const thought = (id, thread_id) => ({ id, speaker: "you", text: id, point: id, thread_id, placed: true, unclear: "", complete: true, at_ms: 0, place_ms: null });
  const world = {
    recaps: [], apps: [], apps_seeded: false, merged: {}, proposals: [],
    threads: [thread("T1"), thread("T2"), thread("T3", "T2"), thread("T4")],
    thoughts: [thought("a", "T1"), thought("b", "T2"), thought("c", "T2"), thought("d", "T3")],
    active: "T2", active_by: { Sam: "T2" },
    suggestions: [{ id: "sg", thread_id: "T2", text: "idea", status: "new" }],
    actions: [{ id: "ac", thread_id: "T2", kind: "reminder", title: "task", when: "", status: "new", done_ms: null }],
  };
  const shape = (w) => JSON.stringify([w.threads.map((t) => [t.id, t.title, t.parent_id]), w.thoughts.map((t) => [t.id, t.thread_id]),
    w.suggestions.map((s) => s.thread_id), w.actions.map((a) => a.thread_id), w.active, w.active_by, w.merged]);

  // A merge, then its undo (the core sends what the merge moved): the map is as it was, order included.
  const merged = apply(world, { type: "thread_merged", from: "T2", into: "T1" });
  assert.ok(!merged.threads.some((t) => t.id === "T2"));
  const unmerge = { thread: thread("T2"), into: "T1", at: 1, thoughts: ["b", "c"], branches: ["T3"], suggestions: ["sg"], actions: ["ac"], proposals: [], active: true, active_by: ["Sam"] };
  const back = apply(merged, { type: "thread_unmerged", unmerge });
  assert.equal(shape(back), shape(world), "everything the merge moved comes back");
  // Said on the merged thread since: it stays; applied again: nothing more.
  const later = apply(apply(merged, { type: "thought_added", thought: thought("e", "T1") }), { type: "thread_unmerged", unmerge });
  assert.equal(later.thoughts.find((t) => t.id === "e").thread_id, "T1");
  assert.equal(shape(apply(back, { type: "thread_unmerged", unmerge })), shape(back));

  // The notes: an AI rename says so with ✦ and Undo; a merge (the person applied it) has Undo but no ✦; an undo is told.
  const renamed = { type: "thread_retitled", thread_id: "T1", title: "Rent", was: "Topic T1" };
  assert.deepEqual(tidyNote(world, renamed), { text: "AI renamed “Topic T1” to “Rent”", ai: true, undo: { kind: "rename", thread_id: "T1" } });
  assert.equal(apply(world, renamed).threads[0].title, "Rent");
  assert.equal(tidyNote(apply(world, renamed), renamed), null, "a repeat says nothing");
  assert.equal(tidyNote(world, { type: "thread_renamed", thread_id: "T1", title: "Rent" }), null, "a person's own rename gets no note");
  assert.deepEqual(tidyNote(world, { type: "thread_merged", from: "T2", into: "T1" }), { text: "Merged “Topic T2” into “Topic T1”", ai: false, undo: { kind: "merge", thread_id: "T2" } });
  assert.equal(tidyNote({ ...world, thoughts: [] }, { type: "thread_merged", from: "T4", into: "T1" }), null, "an empty thread going isn't announced");
  assert.equal(tidyNote(merged, { type: "thread_unmerged", unmerge }).text, "Put back “Topic T2”");

  // Proposals: what each says, waiting until answered, and settled when the map moves past them.
  const rename = { id: "p1", kind: "rename", thread_id: "T4", title: "Grocery list", status: "new" };
  const merge = { id: "p2", kind: "merge", thread_id: "T2", into: "T1", status: "new" };
  let w = apply(apply(world, { type: "tidy_proposed", proposal: rename }), { type: "tidy_proposed", proposal: merge });
  assert.deepEqual(proposalWords(rename, w), { text: "Rename to “Grocery list”?", apply: "Rename", keep: "Keep the title" });
  assert.deepEqual(proposalWords(merge, w), { text: "Same topic as “Topic T1”?", apply: "Merge", keep: "Keep them apart" });
  assert.deepEqual([...waitingByThread(w.proposals).keys()], ["T4", "T2"]);
  w = apply(w, { type: "item_status", id: "p1", status: "dismissed", done_ms: null });
  assert.deepEqual([...waitingByThread(w.proposals).keys()], ["T2"], "× answers it");
  w = apply(w, { type: "thread_merged", from: "T2", into: "T1" });
  assert.equal(waitingByThread(w.proposals).size, 0, "merged anyway: the proposal is done");

  // A new proposal marks its thread as changed out of sight, pointing at its row.
  const { changes } = await server.ssrLoadModule("/src/attention-core.ts");
  const proposed = apply(world, { type: "tidy_proposed", proposal: rename });
  assert.deepEqual(changes(world, proposed, "you"), [{ thread: "T4", element: "item-p1", line: "Rename to “Grocery list”?" }]);

  // The map shows them, the note offers Undo, and every tip fits.
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<ProposalRows thread=\{thread\.id\} \/>/);
  assert.match(app, /core\.mapChange\.undo && <button className="undo"/);
  for (const tip of [TIPS.mapChange, TIPS.tidyRename, TIPS.tidyMerge]) assert.ok(tip.length <= 120, tip);
  assert.doesNotMatch(TIPS.mapChange, /no undo/);
  console.log("tidy-check: ok");
} finally {
  await server.close();
}
