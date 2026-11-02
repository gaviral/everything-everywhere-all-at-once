// No extra dependencies: run with `node scripts/search-check.mjs`.
// Search stays smooth on a big map (2026-11-01): at 1,000 threads typing "l" froze the page 0.9–1.0 s and "li"
// 0.6–0.7 s, because a one-letter query finds every thread and every found card opened at once. Held here: what
// search finds is unchanged, only up to OPEN_LIMIT found cards open themselves, typed letters reach the map deferred,
// and a cleared search comes back at once (jumps scroll to a card on the next frame).
// Search finds words (2026-11-01, persona runs, 4 of 4 synthetic users): the whole query had to be one substring of
// one field, so "dentist thursday", "launch date" and "cafe" (for "Café") found nothing. Held here: every word, in any
// order, anywhere in a thread; everything the old rule found is still found and comes first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { searchMatches, heldOpen, mapQuery, OPEN_LIMIT, RANK_LIMIT, steady, sameCard } = await server.ssrLoadModule("/src/search-rules.ts");

  // 1. What search finds: the rule as it was inline in App.tsx before, on a seeded random map of 1,000 threads.
  const before = (index, search) => new Set(search ? index.filter(({ fields }) => fields.some((text) => text.includes(search))).map(({ id }) => id) : []);
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const words = ["lisbon", "pottery", "class", "under", "$80", "trip", "budget", "rent", "café", "décidé", "Q4", "map"];
  const index = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`,
    fields: Array.from({ length: 1 + rand(6) }, () => Array.from({ length: 1 + rand(5) }, () => words[rand(words.length)]).join(" ").toLocaleLowerCase()) }));
  for (const q of ["", "l", "li", "lis", "lisbon", "class under", "$8", "é", "q4", "zzz", "on p", "trip lisbon", "rent  $80 "]) {
    const found = searchMatches(index, q), was = before(index, q);
    for (const id of was) assert.ok(found.has(id), `"${q}" still finds ${id}, as before`);
    // What the old rule found comes first: what you typed, as you typed it, is the strongest hit.
    assert.deepEqual([...found].slice(0, was.size).sort(), [...was].sort(), `"${q}": the old hits lead`);
  }
  // One plain word finds exactly what it did before.
  for (const q of ["l", "li", "lis", "lisbon", "$8", "q4", "zzz"]) {
    assert.deepEqual([...searchMatches(index, q)].sort(), [...before(index, q)].sort(), `"${q}" finds what it did before`);
  }
  // Fields stay separate: a word can't match across two pieces of text.
  assert.equal(searchMatches([{ id: "a", fields: ["lis", "bon"] }], "lisbon").size, 0, "no match across two fields");

  // 1b. Words, in any order, anywhere in the thread (the persona runs' searches that found nothing).
  const health = { id: "health", fields: ["health", "dentist moved", "it's thursday at 3"] };
  const launch = { id: "launch", fields: ["product launch", "launch moved to the 21st", "date is firm now"] };
  const cafe = { id: "cafe", fields: ["café shifts", "december availability"] };
  const map = [health, launch, cafe];
  const finds = (q) => [...searchMatches(map, q)];
  assert.deepEqual(finds("dentist thursday"), ["health"], "two words in two thoughts of one thread");
  assert.deepEqual(finds("thursday dentist"), ["health"], "any order");
  assert.deepEqual(finds("launch date"), ["launch"], "title word + a thought's word");
  assert.deepEqual(finds("cafe"), ["cafe"], "no accent typed finds the accented word");
  assert.deepEqual(finds("café december"), ["cafe"], "accent typed still finds it");
  assert.deepEqual(finds("dentist thursday?"), ["health"], "a question mark is not a word to find");
  assert.deepEqual(finds("when is the dentist"), ["health"], "question words don't have to be in the thread");
  assert.deepEqual(finds("dentist launch"), [], "every word must be there: one thread each → none");
  assert.deepEqual(finds("is"), ["launch", "health"], "a query of only small words still finds them (\"is\" in \"dentist\" too, after the whole word)");

  // 1c. Ranking: the best hit first, map order breaks ties.
  const order = (fields, q) => [...searchMatches(fields.map((f, i) => ({ id: `r${i}`, fields: f })), q)];
  assert.deepEqual(order([["class notes", "art supplies"], ["art class"]], "art class"), ["r1", "r0"], "the phrase as typed beats words apart");
  assert.deepEqual(order([["dentist", "thursday"], ["dentist on thursday"]], "dentist thursday"), ["r1", "r0"], "words in one thought beat words spread over a thread");
  assert.deepEqual(order([["party"], ["art class"]], "art"), ["r1", "r0"], "a whole word beats the inside of one (\"art\" in \"party\")");
  assert.deepEqual(order([["trip", "budget for rent"], ["rent", "trip budget"]], "rent"), ["r1", "r0"], "the thread named for it beats one that mentions it");
  assert.deepEqual(order([["kids party", "ask about the art table"], ["art class"]], "art"), ["r1", "r0"], "named for it, not a word inside the name");
  assert.deepEqual(order([["rent"], ["rent"], ["rent"]], "rent"), ["r0", "r1", "r2"], "ties keep map order");

  assert.ok(RANK_LIMIT >= 20 && RANK_LIMIT <= 60, `RANK_LIMIT ${RANK_LIMIT}: one to three screens of folded titles (≈ 20 a screen)`);

  // 1d. Fast at 1,000 threads: every letter of a query, typed one by one, well inside a frame.
  const big = Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}`, fields: Array.from({ length: 20 },
    () => Array.from({ length: 12 }, () => words[rand(words.length)]).join(" ").toLocaleLowerCase()) }));
  for (const q of ["l", "li", "lis"]) searchMatches(big, q); // first pass prepares each thread's text once, as the map does
  const typing = ["l", "li", "lis", "lisb", "lisbo", "lisbon", "lisbon ", "lisbon t", "lisbon tr", "lisbon tri", "lisbon trip"];
  // Fastest of 9 per letter: the rule's own cost. Single runs are noise from the machine (GC, other builds: at load 69
  // the old rule's median reached 11.6 ms and single runs 77 ms), and noise would make this check fail at random.
  const spent = typing.map((q) => Math.min(...Array.from({ length: 9 }, () => { const t = performance.now(); searchMatches(big, q); return performance.now() - t; })));
  assert.ok(Math.max(...spent) < 8, `slowest letter ${Math.max(...spent).toFixed(1)} ms (fastest of 9) at 1,000 threads × 20 fields: under half a 60 Hz frame (16.7 ms), so the cards get the rest`);

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
  assert.match(app, /const place = search && matches\.size <= RANK_LIMIT \? new Map\(\[\.\.\.visibleIds\]/, "found threads show best first, up to RANK_LIMIT");
  assert.match(app, /if \(place\) for \(const group of grouped\.values\(\)\) group\.sort\(/, "…each branch list in searchMatches' order");
  assert.match(app, /const collapsed = held\.has\(thread\.id\) \? false :/, "a card opens for search only when heldOpen holds it");
  assert.match(app, /return previousChildren\.current = steady\(previousChildren\.current, grouped\);/, "the grouping goes through steady");
  assert.match(app, /const ThreadCard = memo\(function ThreadCard\([\s\S]*?\n\}, sameCard\);/, "cards skip unchanged renders with sameCard");
  assert.doesNotMatch(app, /searching && matches\.has/, "no card opens just because it matched (every card opened at once)");
  console.log("search-check: ok");
} finally {
  await server.close();
}
