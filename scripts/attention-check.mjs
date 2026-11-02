// No extra dependencies: run with `node scripts/attention-check.mjs`.
// Checks the attention guide's rules (ui/src/attention-core.ts): timings from reading, what counts as an unseen
// change, where marks go after a merge, the "latest" mark, and which spoken words point at "this".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { readMs, LOOK_MS, READ_WPM, changes, carry, newestOwn, newestSaid, pointsAtThis, thisKind, thisBase, direction } = await server.ssrLoadModule("/src/attention-core.ts");

  // Reading time: one look over, then the words at 238 a minute. Never a fixed clock.
  assert.equal(readMs(""), LOOK_MS);
  assert.equal(readMs("Rent Due Friday Rent is due Friday, not sent yet"), LOOK_MS + Math.round((10 * 60_000) / READ_WPM));
  assert.ok(readMs("one two three") < readMs("one two three four five six seven eight"), "longer words, longer look");

  const thought = (id, thread_id, speaker = "Ana", extra = {}) => ({ id, thread_id, speaker, text: id, point: `p ${id}`, placed: !!thread_id,
    complete: true, unclear: "", at_ms: 1, place_ms: 10, ...extra });
  const thread = (id, title = id) => ({ id, title, parent_id: null, status: "open", tags: [], picture: null });
  const world = (extra) => ({ threads: [thread("T1"), thread("T2")], thoughts: [], suggestions: [], actions: [], merged: {}, active: "T1", active_by: {}, ...extra });

  // Your own words landing aren't "unseen": they get the landing's highlight and the latest mark.
  const before = world({ thoughts: [thought("a", "T1")] });
  assert.deepEqual(changes(before, world({ thoughts: [thought("a", "T1"), thought("b", "T2")] }), "Ana"), []);
  // Someone else's thought in a room is.
  assert.deepEqual(changes(before, world({ thoughts: [thought("a", "T1"), thought("b", "T2", "Sam")] }), "Ana"),
    [{ thread: "T2", element: "point-b", line: "p b" }]);
  // A new proposal or suggestion, and a new title (the AI tidied it), are.
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, suggestions: [{ id: "s", thread_id: "T1", text: "Call the landlord", status: "new" }] }), "Ana"),
    [{ thread: "T1", element: "item-s", line: "Call the landlord" }]);
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, actions: [{ id: "x", thread_id: "T2", title: "Pay rent", status: "new" }] }), "Ana"),
    [{ thread: "T2", element: "item-x", line: "Pay rent" }]);
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, threads: [thread("T1", "Rent Due Friday"), thread("T2")] }), "Ana"),
    [{ thread: "T1", element: "title-T1", line: "Rent Due Friday" }]);
  // A kept or dismissed item isn't new.
  assert.deepEqual(changes(before, world({ thoughts: before.thoughts, suggestions: [{ id: "s", thread_id: "T1", text: "x", status: "kept" }] }), "Ana"), []);
  // A merge moves your thought into another thread: that thread changed.
  const merged = world({ threads: [thread("T2")], merged: { T1: "T2" }, thoughts: [thought("a", "T2")] });
  assert.deepEqual(changes(before, merged, "Ana"), [{ thread: "T2", element: "point-a", line: "p a" }]);
  // A mark follows its thread into the merge, and goes with a thread that's gone.
  assert.deepEqual(carry([{ thread: "T1", element: "point-a", line: "x" }], merged), [{ thread: "T2", element: "point-a", line: "x" }]);
  // A new title's mark points at the joined thread's title: the old title's card is gone, so it could never be read.
  assert.deepEqual(carry([{ thread: "T1", element: "title-T1", line: "x" }], merged), [{ thread: "T2", element: "title-T2", line: "T2" }]);
  assert.deepEqual(carry([{ thread: "T9", element: "title-T9", line: "x" }], merged), []);

  // "Latest" moves to your newest landing only; someone else's leaves it where it was.
  assert.equal(newestOwn([thought("a", "T1"), thought("b", "T1"), thought("c", "T2", "Sam")], "Ana"), "b");
  assert.equal(newestOwn([thought("c", "T2", "Sam")], "Ana"), null);
  // On a page that didn't see them land (fresh, or a reconnect), by when you said them; a sample's future time counts least.
  assert.equal(newestSaid([thought("a", "T1", "Ana", { at_ms: 5 }), thought("b", "T1", "Ana", { at_ms: 9 }), thought("c", "T1", "Sam", { at_ms: 20 })], "Ana", 100), "b");
  assert.equal(newestSaid([thought("a", "T1", "Ana", { at_ms: 5 }), thought("s", "T1", "Ana", { at_ms: 500 })], "Ana", 100), "a");
  assert.equal(newestSaid([thought("c", "T1", "Sam")], "Ana", 100), null);

  // "This": only a whole command the core acts on "this" with (spoken.rs `unfold`, main.rs `FOCUS_ON`), also after a
  // correction's lead (catalog.rs `correction`).
  for (const said of ["Collapse this", "expand this one", "Okay, collapse that thread.", "focus on this", "Um, so, can you unfold it please?",
    "Let's collapse this card", "Collapse it all", "Focus on this thread", "Let's focus on this", "Okay, focus on that one", "focus on this mode",
    "No, I meant collapse this", "I was asking you to focus on that one", "Sorry, I meant expand this", "No, I mean open everything under it",
    "I meant to say focus on this", "That's not what I meant, collapse this"])
    assert.ok(pointsAtThis(said), said);
  // Not: talk with "this" in it; a named thread that starts with "this" (the core folds "This weekend"); "open", "show",
  // "hide", "close" and "fold" with "this", which the core leaves as thoughts; a verb the core has no command for; bare
  // "Collapse" and "Focus" (nothing in them points); "focus on" a name; "add this to Reminders" (it adds an action, not
  // a card, and its notice names it); talk after a correction's lead; a bare "No, …" (the live words can't tell it from
  // talk); a correction of a correction.
  for (const said of ["Okay, this is actually working! This is so exciting", "Rent is due Friday", "Show me the garden", "this weekend I'll fix it",
    "It's due Friday", "collapse this weekend", "Expand this thread about rent", "Hide it", "Let's open this card", "move this thread up", "Collapse",
    "Focus", "Let's focus", "Focus on the budget", "Focus on it", "Add this to Reminders", "No, I meant this is great", "I meant to collapse this",
    "No, I said this is great", "I mean this is great", "No, collapse this", "No, I meant no, I meant collapse this", "No, I meant",
    // Focus takes only the core's own tail ("mode", main.rs `focuses_this`) and "please": these stay thoughts there
    // (review: the mark showed for them).
    "Let's focus on that card now", "Focus on this for me", "No, I meant focus on this now", "Focus on this please mode"])
    assert.ok(!pointsAtThis(said), said);
  for (const said of ["Focus on this please", "Please focus on this mode please", "Let's focus on that card, please."])
    assert.equal(thisKind(said), "card", said);
  // One rule for every kind: opening, folding and focusing all take the card you selected or point at (this-card.ts
  // `resolveThis`, as catalog.rs `this`), else your active thread.
  for (const said of ["Collapse this", "Um, so, can you unfold it please?", "Let's collapse this card", "focus on this", "Focus on this thread"])
    assert.equal(thisKind(said), "card", said);
  // A correction is its own kind: it acts only while the core has a turn to correct, and from where undoing that turn
  // takes you (catalog.rs `redo` undoes it first; review: after "Next one" the mark named Bills, Garden folded).
  for (const said of ["No, I meant focus on this", "No, I meant collapse this please", "Wait, I meant collapse this", "Actually no, I mean collapse this"])
    assert.equal(thisKind(said), "correction", said);
  assert.deepEqual(thisBase("card", null, "T2", 5), { active: "T2" });
  assert.deepEqual(thisBase("correction", { until: 10, back_to: "T1" }, "T2", 5), { active: "T1" }, "where the undo takes you");
  assert.deepEqual(thisBase("correction", { until: 10, back_to: null }, "T2", 5), { active: "T2" }, "an undo that doesn't move you");
  assert.equal(thisBase("correction", { until: 10, back_to: "T1" }, "T2", 11), null, "past the core's window: no mark");
  assert.equal(thisBase("correction", null, "T2", 5), null, "no turn to correct (a restarted core): no mark");
  assert.equal(thisBase(null, { until: 10, back_to: "T1" }, "T2", 5), null);
  // Everything under a pointing word is "this" too, with any open or fold verb (spoken.rs `unfold`, catalog); the first
  // "everything" word that fits counts, so "open all of it" is every thread, and so is "open all this" (no link word).
  for (const said of ["Open everything under it", "Hide everything inside of it", "Open all of this", "Show me all the branches of that one",
    "Can we expand everything in this thread"])
    assert.equal(thisKind(said), "card", said);
  for (const said of ["Open all of it", "Show me everything on the map", "Expand everything", "Open everything under the garden", "Open all this"])
    assert.equal(thisKind(said), null, said);
  // The lists mirrored from the core are the core's, word for word: a phrase added there and not here would act with
  // no mark, or one added here would mark a card the core leaves alone.
  const core = (name) => readFileSync(new URL(`../core/src/${name}`, import.meta.url), "utf8");
  // A top-level const (yes_or_no has its own `NO` inside it).
  const list = (source, name) => {
    const found = source.match(new RegExp(`^const ${name}: \\[&str; (\\d+)\\] =\\s*\\[([^\\]]*)\\]`, "m"));
    assert.ok(found, `${name} in the core`);
    const items = [...found[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    assert.equal(items.length, Number(found[1]), name);
    return items;
  };
  const mirror = await server.ssrLoadModule("/src/attention-core.ts");
  assert.deepEqual(mirror.FOCUS_ON, list(core("main.rs"), "FOCUS_ON"), "main.rs FOCUS_ON");
  assert.deepEqual(mirror.CORRECTION, list(core("catalog.rs"), "STRONG"), "catalog.rs STRONG");
  assert.deepEqual(mirror.AFTER_NO, list(core("catalog.rs"), "AFTER_NO"), "catalog.rs AFTER_NO");
  assert.deepEqual(mirror.NO, list(core("catalog.rs"), "NO"), "catalog.rs NO");
  // Beside legibility (legible.ts, legible.css): a highlight's reading time counts the words on screen only, so a
  // point's words said stay out while closed; the live line rolls up as one block, so "· this: …" runs on after the
  // words instead of taking one of its two lines.
  const ui = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");
  assert.match(ui("Attention.tsx"), /querySelectorAll\("[^"]*\[hidden\][^"]*"\)/, "wordsIn skips hidden words");
  assert.match(ui("App.tsx"), /"live words" : "live"\}><span>[^\n]*<ThisEcho [^\n]*<\/span><\/div>/, "the live words and their echo share one span");
  // The unseen dot explains itself as every mark does (Tips.tsx), and the ? list's Symbols names it and the bar.
  assert.match(ui("Attention.tsx"), /className="unseen-dot"[^>]*data-tip=/, "the dot's words in the shared tip");
  assert.match(ui("Symbols.tsx"), /className="symbol-latest"/);
  assert.match(ui("Symbols.tsx"), /className="unseen-dot"/);
  console.log("attention-check: ok");
} finally {
  await server.close();
}
