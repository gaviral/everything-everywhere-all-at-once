// No extra dependencies: run with `node scripts/route-check.mjs`.
// Checks live routing (ui/src/route.ts): while the calls race, the threads the prompt names light up; once the thought
// is on the map, the path to it settles with what decided it; a newer thought takes over; a failed try lights nothing;
// how long the tag stays comes from reading speed; and the map draws it without moving anything.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { routed, placingNow, markFor, lanesFor, landTag, raceLine, holdMs, EMPTY_ROUTE, READ_MS_PER_WORD, NOTICE_MS, LEVEL_MS } =
    await server.ssrLoadModule("/src/route.ts");
  const weighing = (thought_id, candidates, lanes = 2) => ({ stage: "weighing", thought_id, candidates, lanes });
  const decided = (thought_id, path, extra = {}) => ({ stage: "decided", thought_id, path, new: false, skipped: false,
    pick: { action: "continue", thread_id: path.at(-1) ?? "" }, rule: null, why: "", lane: 0, lanes: 2, ms: 2100, ...extra });

  // While the calls race: the named threads are candidates; "active" needs no tag (the card's chip says it).
  let s = routed(EMPTY_ROUTE, weighing("a", [{ thread_id: "T1", why: "active" }, { thread_id: "T3", why: "left unfinished" }]), 0);
  assert.deepEqual(markFor(s, "T1", 0), { kind: "candidate", tag: null, title: null, deep: false });
  assert.equal(markFor(s, "T3", 0).tag, "left unfinished");
  assert.equal(markFor(s, "T2", 0), null, "a thread the prompt doesn't name isn't lit");
  assert.equal(lanesFor(s, "a"), 2);
  assert.equal(lanesFor(s, "b"), 0);

  // A failed try: the core moves on (placing now is another thought, or none): nothing stays lit.
  assert.equal(placingNow(s, null).weighing, null);
  assert.equal(placingNow(s, "a"), s, "still being placed: unchanged");

  // Landed on a branch: its top thread (via) and the branch (here, settling after it); the candidates go out.
  const d = decided("a", ["T1", "T2"], { why: "names the flight" });
  s = routed(s, d, 1_000);
  assert.equal(s.weighing, null);
  assert.equal(markFor(s, "T3", 1_000), null);
  assert.deepEqual(markFor(s, "T1", 1_000), { kind: "via", tag: null, title: null, deep: false });
  assert.deepEqual(markFor(s, "T2", 1_000), { kind: "here", tag: "here", title: "Names the flight. First of 2 calls to answer, in 2.1 s", deep: true });

  // The tag stays as long as noticing it and reading it take (200 words a minute), then gives way.
  assert.equal(READ_MS_PER_WORD, 300);
  assert.equal(NOTICE_MS, 1000);
  assert.equal(holdMs("here · rule: one level of branches"), 1000 + 6 * 300, "words only: the dot is no word to read");
  const until = 1_000 + holdMs(landTag(d));
  assert.ok(markFor(s, "T2", until - 1));
  assert.equal(markFor(s, "T2", until), null);
  assert.equal(markFor(s, "T1", until), null);

  // A rule that put it elsewhere is named, over the model's reason; a new thread or branch says so.
  assert.equal(landTag(decided("x", ["T4"], { new: true, rule: "one level of branches", why: "names the seat" })), "new thread · rule: one level of branches");
  assert.equal(landTag(decided("x", ["T1", "T4"], { new: true })), "new branch");
  assert.equal(raceLine(decided("x", ["T1"], { lanes: 1, ms: 900 })), "Answered in 0.9 s");

  // A newer thought's routing takes over the map at once: the last landing's tag goes.
  s = routed(s, weighing("b", [{ thread_id: "T2", why: "said just before" }]), 1_500);
  assert.equal(markFor(s, "T1", 1_500), null);
  assert.equal(markFor(s, "T2", 1_500).kind, "candidate");
  // Set aside as filler: nothing lands, nothing is lit.
  s = routed(s, decided("b", [], { skipped: true }), 2_000);
  assert.deepEqual(s, EMPTY_ROUTE);
  // A late decided for another thought doesn't put out the one being weighed.
  s = routed(routed(EMPTY_ROUTE, weighing("c", [{ thread_id: "T1", why: "active" }]), 0), decided("z", ["T3"]), 10);
  assert.equal(markFor(s, "T1", 10).kind, "candidate");

  // The map: cards and the pill read the store; an outline, never a border or size, so nothing moves; reduced motion
  // drops the delay and the fade; the quiet-while-talking rule leaves a lit card at full strength.
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  const core = readFileSync(new URL("../ui/src/core.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../ui/src/route.css", import.meta.url), "utf8");
  const legible = readFileSync(new URL("../ui/src/legible.css", import.meta.url), "utf8");
  assert.match(app, /useRouteMark\(thread\.id\)/);
  assert.match(app, /useLanes\(thought\.id\)/);
  assert.match(core, /if \(receiveRoute\(msg\)\) return;/);
  assert.match(core, /routePlacing\(msg\.now\)/);
  assert.match(core, /resetRoute\(\);/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /\b(border-width|padding-block|margin-top|height:\s*\d+px;\s*}\s*\.thread)/, "routing changes no card's size");
  assert.match(css, new RegExp(`--route-delay: ${LEVEL_MS / 1000}s`), "the branch settles LEVEL_MS after its top thread");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*--route-delay: 0s[\s\S]*animation: none/);
  assert.equal((legible.match(/:not\(\.route-lit\)/g) ?? []).length, 3, "every quiet-while-talking selector spares a lit card");
  console.log("route-check: ok");
} finally {
  await server.close();
}
