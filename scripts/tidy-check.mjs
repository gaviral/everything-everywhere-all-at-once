// No extra dependencies: run with `node scripts/tidy-check.mjs`.
// The refiner's renames and merges in the window (ui/src/tidy-core.ts): a merge undone puts the map back exactly as
// the core does, an AI rename's note offers Undo, a person's own rename gets no note, and proposals read and wait right.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";
import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";

globalThis.location = new URL("http://localhost:4321/");

const server = await uiServer();
try {
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const { tidyNote, joinNotes, proposalWords, waitingByThread } = await server.ssrLoadModule("/src/tidy-core.ts");
  const { TIPS } = await server.ssrLoadModule("/src/Tips.tsx");

  const thread = (id, parent_id = null) => ({ id, title: `Topic ${id}`, parent_id, status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" });
  const thought = (id, thread_id) => ({ id, speaker: "you", text: id, point: id, thread_id, placed: true, unclear: "", complete: true, at_ms: 0, place_ms: null });
  const world = {
    recaps: [], apps: [], apps_seeded: false, merged: {}, proposals: [],
    threads: [thread("T1"), thread("T2"), thread("T3", "T2"), thread("T4")],
    thoughts: [thought("a", "T1"), thought("b", "T2"), thought("c", "T2"), thought("d", "T3")],
    active: "T2", active_by: { Colleague: "T2" },
    suggestions: [{ id: "sg", thread_id: "T2", text: "idea", status: "new" }],
    actions: [{ id: "ac", thread_id: "T2", kind: "reminder", title: "task", when: "", status: "new", done_ms: null }],
  };
  const shape = (w) => JSON.stringify([w.threads.map((t) => [t.id, t.title, t.parent_id]), w.thoughts.map((t) => [t.id, t.thread_id]),
    w.suggestions.map((s) => s.thread_id), w.actions.map((a) => a.thread_id), w.active, w.active_by, w.merged]);

  // A merge, then its undo (the core sends what the merge moved): the map is as it was, order included.
  const merged = apply(world, { type: "thread_merged", from: "T2", into: "T1" });
  assert.ok(!merged.threads.some((t) => t.id === "T2"));
  const unmerge = { thread: thread("T2"), into: "T1", at: 1, thoughts: ["b", "c"], branches: ["T3"], suggestions: ["sg"], actions: ["ac"], proposals: [], active: true, active_by: ["Colleague"] };
  const back = apply(merged, { type: "thread_unmerged", unmerge });
  assert.equal(shape(back), shape(world), "everything the merge moved comes back");
  // Said on the merged thread since: it stays; applied again: nothing more.
  const later = apply(apply(merged, { type: "thought_added", thought: thought("e", "T1") }), { type: "thread_unmerged", unmerge });
  assert.equal(later.thoughts.find((t) => t.id === "e").thread_id, "T1");
  assert.equal(shape(apply(back, { type: "thread_unmerged", unmerge })), shape(back));

  // The notes: an AI rename says so with ✦ and Undo; a merge (the person applied it) has Undo but no ✦; an undo is told.
  const renamed = { type: "thread_retitled", thread_id: "T1", title: "Rent", was: "Topic T1" };
  assert.deepEqual(tidyNote(world, renamed), { text: "AI renamed “Topic T1” to “Rent”", ai: true, undo: [{ kind: "rename", thread_id: "T1" }], renamed: [["Topic T1", "Rent"]] });
  assert.equal(apply(world, renamed).threads[0].title, "Rent");
  assert.equal(tidyNote(apply(world, renamed), renamed), null, "a repeat says nothing");
  assert.equal(tidyNote(world, { type: "thread_renamed", thread_id: "T1", title: "Rent" }), null, "a person's own rename gets no note");
  assert.deepEqual(tidyNote(world, { type: "thread_merged", from: "T2", into: "T1" }), { text: "Merged “Topic T2” into “Topic T1”", ai: false, undo: [{ kind: "merge", thread_id: "T2" }] });
  assert.equal(tidyNote({ ...world, thoughts: [] }, { type: "thread_merged", from: "T4", into: "T1" }), null, "an empty thread going isn't announced");
  assert.equal(tidyNote(merged, { type: "thread_unmerged", unmerge }).text, "Put back “Topic T2”");
  // A pass's renames arrive one by one: each joins the note still up, so none loses its Undo; a merge replaces it.
  const note = (id, was, title) => tidyNote(world, { type: "thread_retitled", thread_id: id, title, was });
  const two = joinNotes(note("T1", "Topic T1", "Rent"), note("T2", "Topic T2", "Budget"));
  assert.deepEqual(two, { text: "AI renamed “Topic T1” to “Rent” and “Topic T2” to “Budget”", ai: true,
    undo: [{ kind: "rename", thread_id: "T1" }, { kind: "rename", thread_id: "T2" }], renamed: [["Topic T1", "Rent"], ["Topic T2", "Budget"]] });
  const three = joinNotes(two, note("T4", "Topic T4", "Groceries"));
  assert.equal(three.text, "AI renamed 3 topics: “Rent”, “Budget” and “Groceries”");
  assert.equal(three.undo.length, 3);
  assert.equal(joinNotes(null, note("T1", "Topic T1", "Rent")).undo.length, 1, "nothing up: the note alone");
  const mergeNote = tidyNote(world, { type: "thread_merged", from: "T2", into: "T1" });
  assert.equal(joinNotes(two, mergeNote), mergeNote);
  assert.equal(joinNotes(mergeNote, note("T1", "Topic T1", "Rent")).undo.length, 1);
  // The person's chosen title (a proposal's Rename, an AI rename undone): applied, and no note.
  const chosen = { type: "title_chosen", thread_id: "T1", title: "Pay rent" };
  assert.equal(apply(world, chosen).threads[0].title, "Pay rent");
  assert.equal(tidyNote(world, chosen), null);

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

  // A merge leaves the thread's other proposals behind, as the core does: a rename meant for T2 never shows on T1.
  const renameT2 = { id: "p3", kind: "rename", thread_id: "T2", title: "Rent payment", status: "new" };
  const mergeT2 = { id: "p4", kind: "merge", thread_id: "T2", into: "T4", status: "new" };
  let m = apply(apply(world, { type: "tidy_proposed", proposal: renameT2 }), { type: "tidy_proposed", proposal: mergeT2 });
  m = apply(m, { type: "thread_merged", from: "T2", into: "T1" });
  assert.deepEqual(m.proposals.map((p) => [p.id, p.thread_id, p.status]), [["p3", "T2", "done"], ["p4", "T2", "done"]]);
  assert.equal(waitingByThread(m.proposals).size, 0);
  // Undone: they wait on T2 again (the core lists them in what the merge moved).
  m = apply(m, { type: "thread_unmerged", unmerge: { ...unmerge, proposals: ["p3", "p4"] } });
  assert.deepEqual(m.proposals.map((p) => [p.id, p.thread_id, p.status]), [["p3", "T2", "new"], ["p4", "T2", "new"]]);
  // One at a time on a card: the rename first, the merge once it's answered.
  assert.deepEqual(waitingByThread(m.proposals).get("T2").map((p) => p.id), ["p3"]);
  m = apply(m, { type: "item_status", id: "p3", status: "dismissed", done_ms: null });
  assert.deepEqual(waitingByThread(m.proposals).get("T2").map((p) => p.id), ["p4"]);

  // A new proposal marks its thread as changed out of sight, pointing at its row.
  const { changes } = await server.ssrLoadModule("/src/attention-core.ts");
  const proposed = apply(world, { type: "tidy_proposed", proposal: rename });
  assert.deepEqual(changes(world, proposed, "you"), [{ thread: "T4", element: "item-p1", line: "Rename to “Grocery list”?" }]);

  // A later point withdrew or corrected a waiting idea or task (refiner.rs `refine`): the same row changes, the note
  // says what and why with Undo, a repeat says nothing, and the Undo's change puts it back.
  const state = (status, text, when = "") => ({ status, text, when });
  const due = { ...world, actions: [{ ...world.actions[0], kind: "event", title: "Midterm", when: "2026-11-10" }] };
  const moved = { type: "item_refined", id: "ac", was: state("new", "Midterm", "2026-11-10"), now: state("new", "Midterm", "2026-11-11"), why: "midterm is Wednesday" };
  const movedNote = tidyNote(due, moved);
  // The day in this machine's own words, as the row writes it ("Wed, Nov 11" in the US, "Wed 11 Nov" in the UK).
  const wed = new Date(2026, 10, 11, 9).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  assert.equal(movedNote.text, `AI moved “Midterm” to ${wed}: midterm is Wednesday`);
  assert.deepEqual([movedNote.ai, movedNote.restore, movedNote.undo], [true, ["ac"], undefined]);
  const after = apply(due, moved);
  assert.deepEqual([after.actions[0].when, after.actions[0].status, after.actions.length], ["2026-11-11", "new", 1]);
  assert.equal(tidyNote(after, moved), null, "a repeat says nothing");
  const dropped = { type: "item_refined", id: "sg", was: state("new", "idea"), now: state("dismissed", "idea"), why: "trip cancelled" };
  assert.equal(apply(world, dropped).suggestions[0].status, "dismissed");
  const both = joinNotes(movedNote, tidyNote(world, dropped));
  assert.equal(both.text, `AI moved “Midterm” to ${wed} and took back “idea”`);
  assert.deepEqual(both.restore, ["ac", "sg"]);
  const withRename = joinNotes(both, note("T1", "Topic T1", "Rent"));
  assert.deepEqual([withRename.restore.length, withRename.undo.length], [2, 1], "a rename in the same pass keeps every Undo");
  assert.equal(withRename.text, `AI renamed “Topic T1” to “Rent” · AI moved “Midterm” to ${wed} and took back “idea”`);
  assert.deepEqual(apply(after, { type: "item_restored", id: "ac", to: moved.was }).actions[0], due.actions[0]);

  // The map shows them, the note offers Undo, and every tip fits.
  const { MapCards } = await server.ssrLoadModule("/src/MapCards.tsx");
  const { TidyProvider } = await server.ssrLoadModule("/src/Tidy.tsx");
  const proposalCard = (id, proposal = rename) => renderToStaticMarkup(React.createElement(TidyProvider,
    { world: { ...world, proposals: [proposal] }, decide() {} }, React.createElement(MapCards, {
      active: id, on: {}, activePath: new Set([id]), rooms: new Map(),
      childrenByParent: new Map([[null, [world.threads.find(t => t.id === id)]]]),
      thoughtsByThread: new Map(), ideasByThread: new Map(), actionsByThread: new Map(),
      held: new Set([id]), expanded: {}, setExpanded() {}, keptOpen: { current: new Set() },
    })));
  const shownProposal = proposalCard("T4");
  assert.ok(shownProposal.includes("Rename to “Grocery list”?"), "the topic card shows its waiting proposal");
  assert.ok(shownProposal.includes(">Rename</button>") && shownProposal.includes('aria-label="Keep the title"'), "the proposal offers apply and keep controls");
  assert.ok(!proposalCard("T2").includes("Grocery list"), "a proposal never appears on another topic");
  assert.ok(!proposalCard("T4", { ...rename, status: "dismissed" }).includes("Grocery list"), "dismissed proposals leave the card");
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /\(core\.mapChange\.undo \|\| core\.mapChange\.restore\) && <button className="undo"/);
  assert.match(app, /core\.restore\(core\.mapChange!\.restore/);
  assert.doesNotMatch(app, /mapChangeVisible/, "a hidden note is gone from the core's state, so nothing joins it");
  for (const tip of [TIPS.mapChange, TIPS.mapRefined, TIPS.tidyRename, TIPS.tidyMerge]) assert.ok(tip.length <= 120, tip);
  assert.doesNotMatch(TIPS.mapChange, /no undo/);
  console.log("tidy-check: ok");
} finally {
  await server.close();
}
