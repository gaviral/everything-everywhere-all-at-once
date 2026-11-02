// No extra dependencies: run with `node scripts/search-check.mjs`.
// Search stays smooth on a big map (2026-11-01): at 1,000 threads typing "l" froze the page 0.9–1.0 s and "li"
// 0.6–0.7 s, because a one-letter query finds every thread and every found card opened at once. Held here: what
// search finds is unchanged, only up to OPEN_LIMIT found cards open themselves, typed letters reach the map deferred,
// and a cleared search comes back at once (jumps scroll to a card on the next frame).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
const server = await uiServer();
try {
  const { searchMatches, heldOpen, mapQuery, OPEN_LIMIT, steady, sameCard } = await server.ssrLoadModule("/src/search-rules.ts");

  // 1. What search finds: the rule as it was inline in App.tsx before, on a seeded random map of 1,000 threads.
  const before = (index, search) => new Set(search ? index.filter(({ fields }) => fields.some((text) => text.includes(search))).map(({ id }) => id) : []);
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const words = ["lisbon", "pottery", "class", "under", "$80", "trip", "budget", "rent", "café", "décidé", "Q4", "map"];
  const index = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`,
    fields: Array.from({ length: 1 + rand(6) }, () => Array.from({ length: 1 + rand(5) }, () => words[rand(words.length)]).join(" ").toLocaleLowerCase()) }));
  for (const q of ["", "l", "li", "lis", "lisbon", "class under", "$8", "é", "q4", "zzz", "on p"]) {
    assert.deepEqual([...searchMatches(index, q)].sort(), [...before(index, q)].sort(), `"${q}" finds what it did before`);
  }
  // Fields stay separate: a query can't match across two pieces of text.
  assert.equal(searchMatches([{ id: "a", fields: ["lis", "bon"] }], "lisbon").size, 0, "no match across two fields");

  // 2. Which found cards open: all of them up to the limit, else none (never an arbitrary first few).
  const ids = (n) => new Set(Array.from({ length: n }, (_, i) => `t${i}`));
  assert.equal(heldOpen(ids(0)).size, 0, "nothing found, nothing held");
  assert.equal(heldOpen(ids(3)).size, 3, "a few found cards all open, as before");
  assert.equal(heldOpen(ids(OPEN_LIMIT)).size, OPEN_LIMIT, "up to the limit all open");
  assert.equal(heldOpen(ids(OPEN_LIMIT + 1)).size, 0, "past the limit none open");
  assert.equal(heldOpen(ids(1000)).size, 0, "one letter on a big map opens nothing (it froze the page ≈ 1 s)");
  assert.ok(OPEN_LIMIT >= 6 && OPEN_LIMIT <= 12, `OPEN_LIMIT ${OPEN_LIMIT}: at least a screen of cards (≈ 6), at most two (12), where the keystroke stays in a frame`);

  // 3. Typed letters reach the map deferred; a cleared search comes back at once.
  assert.equal(mapQuery("lis", "li"), "li", "a typed letter waits for the deferred render");
  assert.equal(mapQuery("", "lisbon"), "", "clearing the search shows the whole map at once");
  assert.equal(mapQuery("  ", "l"), "  ", "a blank box is a cleared search");

  // 3b. A letter that changes no card re-renders none: the grouping keeps its lists, and a card skips while its
  // subtree's lists and its props are the same (re-rendering 1,000 unchanged cards held the page 56–72 ms).
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const was = new Map([[null, [a, b]], ["a", [c]]]);
  assert.equal(steady(was, new Map([[null, [a, b]], ["a", [c]]])), was, "same grouping → the same map");
  const changed = steady(was, new Map([[null, [a]], ["a", [c]]]));
  assert.notEqual(changed, was, "a card gone → a new map");
  assert.equal(changed.get("a"), was.get("a"), "…that keeps the lists that didn't change");
  const props = (map, extra = {}) => ({ thread: a, childrenByParent: map, held: NONE_SET, ...extra });
  const NONE_SET = new Set();
  assert.ok(sameCard(props(was), props(changed)), "a card whose subtree didn't change skips");
  assert.ok(!sameCard(props(was), props(new Map([[null, [a, b]], ["a", [c, b]]]))), "a branch added under it re-renders it");
  assert.ok(!sameCard(props(was), props(new Map([[null, [a, b]], ["a", [c]], ["c", [b]]]))), "a change two levels down re-renders it");
  assert.ok(!sameCard(props(was), props(was, { held: new Set(["a"]) })), "any other prop changing re-renders it");

  // 4. App.tsx wires them: the deferred query, the rule's matches, and cards held open only by heldOpen.
  assert.match(app, /const deferredQuery = useDeferredValue\(query\);\s*const search = mapQuery\(query, deferredQuery\)/, "the map's query is deferred through mapQuery");
  assert.match(app, /searchMatches\(searchIndex, search\)/, "the map finds with searchMatches");
  assert.match(app, /const collapsed = held\.has\(thread\.id\) \? false :/, "a card opens for search only when heldOpen holds it");
  assert.match(app, /return previousChildren\.current = steady\(previousChildren\.current, grouped\);/, "the grouping goes through steady");
  assert.match(app, /const ThreadCard = memo\(function ThreadCard\([\s\S]*?\n\}, sameCard\);/, "cards skip unchanged renders with sameCard");
  assert.doesNotMatch(app, /searching && matches\.has/, "no card opens just because it matched (every card opened at once)");
  console.log("search-check: ok");
} finally {
  await server.close();
}
