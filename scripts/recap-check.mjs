// No extra dependencies: run with `node scripts/recap-check.mjs`.
// Which messages close an open Recap (`movesAsked` in ui/src/core.ts): fed one at a time, each with the map as it
// was before it, the way a window gets them from the core. And the sheet's order (ui/src/Recap.tsx, rendered with
// React's server renderer): the answer to "What did I decide today?" comes first.
import assert from "node:assert/strict";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { uiServer } from "./ui-server.mjs";

// room.tsx reads the page's address as it loads: this is the app opened alone.
globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
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
  assert.deepEqual(closes([said("theirs", "Colleague"), placed("theirs", "T3"), touched("T3"), moved("T3", "Colleague"), moved("T1", "Colleague")]),
    [false, false, false, false, false], "another speaker");
  // Only the rest of the landing's commit counts as it. A landing that didn't move you (you clicked away while it was
  // placed) leaves nothing behind: the next move to that thread is asked for.
  assert.deepEqual(closes([said("x"), placed("x", "T2"), touched("T2"), notice("Back to Topic T2"), moved("T2")]),
    [false, false, false, false, true], "a move asked for after a landing that didn't move you");

  // The sheet after "What did I decide today?": decisions first, then plans and open questions, then what you worked on.
  const { Recap } = await server.ssrLoadModule("/src/Recap.tsx");
  const item = (thread_id, text) => ({ thread_id, text });
  const recap = { period: "today", since_ms: 0, through_ms: 1, generated_ms: 2, source_key: "", summary: "A day of demo planning.",
    decisions: [item("T1", "Open with the mic turning on")], plans: [item("T2", "Book the cooking class")],
    questions: [item("T3", "Which room do we record in?")], worked_on: [item("T1", "How the demo opens")], unfinished: [],
    actions: [], thought_count: 4, thread_count: 3, limited: false };
  const sheet = (shown, loading = false, world = map) => ReactDOMServer.renderToStaticMarkup(React.createElement(Recap, { view: { period: "today", loading,
    message: "", recap: shown }, world, connected: true, noKey: false, listening: true, onRequest() {}, onMark: () => true,
    onClose() {}, onFocus() {} })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const order = (shown, words) => words.map((w) => shown.indexOf(w)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]));
  assert.ok(order(sheet(recap), ["Decisions made", "Open with the mic turning on", "Plans", "Open questions", "What you worked on"]),
    "decisions first, then plans, open questions and what you worked on");
  // None decided: it says so, still first.
  assert.ok(order(sheet({ ...recap, decisions: [] }), ["Decisions made", "None yet", "Plans", "What you worked on"]), "no decisions yet");
  // Asked while a newer one is made: the saved recap (kept current in the background) is there at once, decisions
  // first, and the sheet says it's being brought up to date rather than making the person wait on an empty sheet.
  const updating = sheet(recap, true);
  assert.ok(order(updating, ["Bringing this up to date…", "Decisions made", "Open with the mic turning on"]), "the saved recap shows while loading");
  assert.ok(sheet(null, true).includes("Gathering your thoughts…") && !sheet(null, true).includes("Decisions made"), "nothing saved yet");
  // The header and the Recap count thoughts one way, as the cards show them: a part said before a pause and the one
  // carrying it on are one thought. The core's `thought_count` counts both, and stays so, since Export keeps a
  // recap's decisions by it (export-md.ts); the sheet counts from the map (review ui-recap-palace #2).
  const joined = { ...map, thoughts: [thought("I never finish my", "T1", { at_ms: 1 }), thought("sentences", "T1", { at_ms: 1 }),
    thought("rent", "T2", { at_ms: 1 }), thought("later", "T2", { at_ms: 5 })], notes: { sentences: { continues: "I never finish my" } } };
  assert.match(sheet({ ...recap, thought_count: 3, thread_count: 2 }, false, joined), / 2 thoughts · 2 topics · /,
    "the joined pair is one thought; one said after the recap isn't in it");
  const { ideaCounts } = await server.ssrLoadModule("/src/chunks.tsx");
  assert.deepEqual(ideaCounts(joined, 0, 5), { thoughts: 3, threads: 2 });
  // A part carried on after the period still counts in it: the recap of [0, 2] keeps "rent" when "later" (said at 5)
  // carries it on.
  const laterJoin = { ...joined, notes: { ...joined.notes, later: { continues: "rent" } } };
  assert.deepEqual(ideaCounts(laterJoin, 0, 2), { thoughts: 2, threads: 2 }, "a continuation outside the period doesn't hide its head");
  assert.deepEqual(ideaCounts(laterJoin, 0, 5), { thoughts: 2, threads: 2 }, "inside it, the pair is one thought");
  const appSource = (await import("node:fs")).readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /return ideaCounts\(world, start, Date\.now\(\)\);/, "the header counts with the same function");

  // Answers arrive in the order asked: one for a period the sheet has since moved off never replaces the newer request.
  const { nextRecapView } = await server.ssrLoadModule("/src/Recap.tsx");
  const st = (period, loading, shown = null) => ({ type: "recap_state", period, loading, message: "", recap: shown });
  let view = null;
  for (const msg of [st("today", true), st("session", true), st("today", false, recap)]) view = nextRecapView(view, msg);
  assert.ok(view.period === "session" && view.loading, "Today's late answer leaves the Session request showing as in progress");
  view = nextRecapView(view, st("session", false, { ...recap, period: "session" }));
  assert.ok(view.period === "session" && !view.loading && view.recap, "then Session's answer shows");
  assert.equal(nextRecapView(null, st("today", false, recap)), null, "a closed sheet stays closed");
  assert.equal(nextRecapView(view, st("today", true)).period, "today", "a new request, spoken or clicked, still switches it");

  // Reduced motion: the loading line still waits 400 ms (styles.css's blanket `animation: none !important` would
  // otherwise show it at once and flash it on a recap that answers in milliseconds).
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../ui/src/recap.css", import.meta.url), "utf8");
  const reduced = css.match(/prefers-reduced-motion: reduce\)\s*\{\s*\.recap-feedback \.recap-loading\s*\{([^}]*)\}/);
  assert.ok(reduced && /400ms/.test(reduced[1]) && /!important/.test(reduced[1]), "reduced motion keeps the 400 ms wait");

  console.log("Recap checks passed: a view, a search's jump, “next one”, “last one” and “where was I?” close it; your words moving you, a landing where you'd clicked meanwhile, an import's end and others' moves don't; the sheet puts decisions first, shows the saved recap at once while a newer one is made, never lets an older answer replace a newer request, and keeps the 400 ms wait under reduced motion.");
} finally {
  await server.close();
}
