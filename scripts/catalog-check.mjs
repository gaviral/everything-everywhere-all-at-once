// No extra dependencies: run with `node scripts/catalog-check.mjs`.
// Checks the window's side of the action catalog: which card "this" is (attention.ts), that it's told to the core
// only when it changes, and that a spoken fix of a "Did you mean …?" ("No, Muse Lark") lands as the core applies it.
import assert from "node:assert/strict";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { threadOf, selectedThread, watchAttention } = await server.ssrLoadModule("/src/attention.ts");
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
