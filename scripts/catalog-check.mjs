// No extra dependencies: run with `node scripts/catalog-check.mjs`.
// Checks the window's side of the action catalog: which card "this" is (this-card.ts), that it's told to the core
// only when it changes and again on each connection, that Undo of a view or fold puts back what the window showed, that
// a thread taken back leaves the map, and that a spoken fix of a "Did you mean …?" ("No, Muse Lark") lands as the core
// applies it.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { threadOf, selectedThread, watchAttention, attentionTeller, attend, resolveThis, POINTER_MS } = await server.ssrLoadModule("/src/this-card.ts");
  const { reverter } = await server.ssrLoadModule("/src/revert.ts");
  const { apply } = await server.ssrLoadModule("/src/core.ts");

  // Stand-ins for the page: a map card (id thread-T2), a Palace tile (data-thread T5), and the dock (no card).
  const mapCard = { id: "thread-T2", dataset: {} };
  const tile = { id: "", dataset: { thread: "T5" } };
  const element = (card, focusVisible = false) => ({ closest: () => card, matches: (s) => s === ":focus-visible" && focusVisible });
  const inCard = element(mapCard);
  assert.equal(threadOf(inCard), "T2");
  assert.equal(threadOf(element(tile)), "T5");
  assert.equal(threadOf(element(null)), null, "the dock is no card");
  assert.equal(threadOf({ parentElement: inCard }), "T2", "a text node reads from its parent");
  assert.equal(threadOf(null), null);

  // Selected: words selected in a card first, else keyboard focus in one; a mouse click's focus isn't a selection.
  const body = {};
  const doc = (selection, active) => ({ getSelection: () => selection, activeElement: active, body });
  const none = { isCollapsed: true };
  assert.equal(selectedThread(doc({ isCollapsed: false, anchorNode: { parentElement: inCard } }, element(tile, true))), "T2");
  assert.equal(selectedThread(doc(none, element(tile, true))), "T5");
  assert.equal(selectedThread(doc(none, element(tile, false))), null, "clicked, not selected");
  assert.equal(selectedThread(doc(none, body)), null);

  // Told only on a change: moving within a card says nothing new.
  const handlers = {};
  const page = { ...doc(none, body), addEventListener: (type, f) => { handlers[type] = f; }, removeEventListener: () => {},
    documentElement: { addEventListener: (type, f) => { handlers[type] = f; }, removeEventListener: () => {} } };
  const told = [];
  const stop = watchAttention((selected, pointed) => told.push([selected, pointed]), page);
  handlers.pointerover({ target: inCard });
  handlers.pointerover({ target: inCard });
  handlers.pointerover({ target: element(tile) });
  handlers.pointerover({ target: element(null) });
  handlers.pointerleave();
  stop();
  assert.deepEqual(told, [[null, "T2"], [null, "T5"], [null, null]]);

  // Typing "this" keeps what the keyboard selected: focus moving into the composer (it's in no card) leaves the card
  // and point you were on as "this", ahead of the pointer; a click elsewhere, Esc or focus anywhere else drops them
  // (spec-keyboard 3: Tab to a point, type "delete this" → your newest thought went instead).
  {
    const at = (selectors) => ({ closest: (s) => selectors[s] ?? null, matches: (s) => s === ":focus-visible" });
    const card = { id: "thread-T2", dataset: {} };
    const point = at({ "section.thread[id^='thread-'], [data-thread]": card, "li[id^='point-']": { id: "point-th-1" } });
    const composer = at({ "form.composer": {} });
    const search = at({});
    const on = {};
    const kb = { getSelection: () => none, activeElement: body, body, addEventListener: (t, f) => { on[t] = f; }, removeEventListener: () => {},
      documentElement: { addEventListener: (t, f) => { on[t] = f; }, removeEventListener: () => {} } };
    const heard = [];
    const quit = watchAttention((...a) => heard.push(a), kb);
    const focusOn = async (el) => { kb.activeElement = el; on.focusin({ target: el }); await new Promise((r) => setTimeout(r, 5)); };
    await focusOn(point);
    await focusOn(composer);
    on.pointerover({ target: element(tile) });
    assert.deepEqual(heard.at(-1), ["T2", "T5", "th-1"], "typing: the card and point you selected stay \"this\", ahead of the pointer");
    on.pointerdown({ target: composer });
    assert.deepEqual(heard.at(-1), ["T2", "T5", "th-1"], "a click in the composer keeps them");
    on.keydown({ key: "Escape", target: composer });
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(heard.at(-1), [null, "T5", null], "Esc drops them");
    await focusOn(point);
    await focusOn(composer);
    on.pointerdown({ target: search });
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(heard.at(-1), [null, "T5", null], "a click elsewhere drops them");
    await focusOn(point);
    await focusOn(search);
    assert.deepEqual(heard.at(-1), [null, "T5", null], "focus anywhere but the composer drops them");
    await focusOn(composer);
    assert.deepEqual(heard.at(-1), [null, "T5", null], "and they don't come back");
    quit();
  }

  // Told again on every connection: a card pointed at while the connection was down (the send failed) still counts.
  const teller = attentionTeller();
  const sent = [];
  teller.resend((m) => sent.push(m));
  assert.deepEqual(sent, [], "nothing to tell yet");
  teller.tell(null, "T2", () => false);
  teller.resend((m) => sent.push(m));
  teller.resend((m) => sent.push(m));
  assert.deepEqual(sent.map((m) => JSON.parse(m)), [{ type: "attention", selected: null, pointed: "T2" }, { type: "attention", selected: null, pointed: "T2" }]);

  // What the teller told is what the window's own "this" mark reads (Attention.tsx), and each change is heard.
  let heard = 0;
  const unwatch = teller.watch(() => heard++);
  teller.tell("T5", "T2", () => true);
  unwatch();
  teller.tell(null, null, () => true);
  assert.equal(heard, 1, "a watcher hears changes until it stops");
  assert.deepEqual([teller.attending().selected, teller.attending().pointed, teller.attending().left?.id], [null, null, "T2"]);

  // "This" picked as catalog.rs `resolve_this` picks it: selected, else pointed, else the card the pointer left within
  // POINTER_MS, else the active thread; only cards on the map count, a merged one as the thread it joined.
  const map = { threads: [{ id: "T1" }, { id: "T2" }, { id: "T3" }], merged: { T9: "T3" } };
  const nowhere = { selected: null, pointed: null, left: null };
  assert.equal(resolveThis({ selected: "T2", pointed: "T3", left: null }, map, "T1", 0), "T2", "selection first");
  assert.equal(resolveThis({ selected: null, pointed: "T3", left: null }, map, "T1", 0), "T3", "then the pointer");
  assert.equal(resolveThis(nowhere, map, "T1", 0), "T1", "else the thread you're on");
  assert.equal(resolveThis({ selected: "T7", pointed: "T9", left: null }, map, "T1", 0), "T3", "a gone card doesn't count; a merged one is its thread");
  const off = attend(attend(nowhere, null, "T2", 1_000), null, null, 2_000);
  assert.deepEqual(off.left, { id: "T2", at: 2_000 }, "the card the pointer left, with when");
  assert.equal(resolveThis(off, map, "T1", 2_000 + POINTER_MS), "T2", "still this within POINTER_MS");
  assert.equal(resolveThis(off, map, "T1", 2_001 + POINTER_MS), "T1", "then the thread you're on");
  assert.deepEqual(attend(off, "T3", null, 3_000).left, off.left, "a selection alone leaves the left card as it was");

  // Undo of a voice view or fold: what was kept just before it comes back, once.
  const shown = reverter();
  assert.equal(shown.take(), null, "nothing kept: a revert changes nothing");
  shown.keep({ view: "map", expanded: { T1: false } });
  shown.keep({ view: "palace", expanded: {} });
  assert.deepEqual(shown.take(), { view: "palace", expanded: {} }, "the latest ask's");
  assert.equal(shown.take(), null, "once");

  // A thread taken back leaves the map only while empty, and nobody stays on it.
  const camping = { threads: [{ id: "T5", parent_id: null }], thoughts: [], active: "T5", active_by: { you: "T5" }, merged: {} };
  const removed = apply(camping, { type: "thread_removed", thread_id: "T5" });
  assert.deepEqual([removed.threads, removed.active, removed.active_by], [[], null, {}]);
  const held = { ...camping, thoughts: [{ id: "x", thread_id: "T5" }] };
  assert.equal(apply(held, { type: "thread_removed", thread_id: "T5" }), held, "a thread with words stays");

  // "Did you mean “Muse Spark”?" answered: yes takes the guess, a fix in your words takes those, no keeps the words.
  const asked = { threads: [{ id: "T1", title: "AI", last_point: "Ask muse bark" }], thoughts: [{ id: "q", thread_id: "T1",
    text: "ask muse bark about it", point: "Ask muse bark", unclear: "muse bark", guess: "Muse Spark", heard: "", fixed: "" }] };
  const answered = (change) => apply(asked, { type: "thought_corrected", thought_id: "q", ...change }).thoughts[0];
  assert.equal(answered({ accept: true }).text, "ask Muse Spark about it");
  assert.equal(answered({ accept: true, with: "Muse Lark" }).text, "ask Muse Lark about it");
  assert.equal(answered({ accept: true, with: "Muse Lark" }).point, "Ask Muse Lark");
  assert.equal(answered({ accept: false }).text, "ask muse bark about it");
  assert.equal(answered({ accept: true }).guess, "");
  console.log("catalog-check: ok");
} finally {
  await server.close();
}
