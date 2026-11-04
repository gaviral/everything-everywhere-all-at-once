// No extra dependencies: run with `node scripts/chunks-check.mjs`.
// Two parts said across a pause show as one point: which thoughts a card shows, the words behind the point, the
// world's notes as changes arrive, and that the marks on a point explain themselves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { asIdeas, carriedIds, wordsSaid, CHUNK_TIPS } = await server.ssrLoadModule("/src/chunks.tsx");
  const { apply } = await server.ssrLoadModule("/src/core.ts");
  const thought = (id, text = id) => ({ id, thread_id: "T1", at_ms: 0, speaker: "you", text, point: text, placed: true,
    complete: true, unclear: "", place_ms: 10 });
  const shown = (thoughts, notes) => asIdeas(thoughts, notes).map(({ thought, heads }) => [...heads.map((h) => h.id), thought.id].join("+"));

  // "I never finish my" … "Sentences.": one point, at the later part's place, with both parts' words.
  const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => thought(id));
  assert.deepEqual(shown([a, b, c], { c: { continues: "a" } }), ["b", "a+c"]);
  // No note, or a note without a link: each its own point.
  assert.deepEqual(shown([a, b, c], {}), ["a", "b", "c"]);
  assert.deepEqual(shown([a, b], { b: { why: "names the lease" } }), ["a", "b"]);
  // Three parts: one point.
  assert.deepEqual(shown([a, b, c], { b: { continues: "a" }, c: { continues: "b" } }), ["a+b+c"]);
  // A link to a thought on another card (or gone): ignored, nothing hidden.
  assert.deepEqual(shown([b, c], { c: { continues: "a" } }), ["b", "c"]);
  // Two turns both read as finishing one: it stays with the first; the second shows alone.
  assert.deepEqual(shown([a, b, c], { b: { continues: "a" }, c: { continues: "a" } }), ["a+b", "c"]);
  // Only a part said earlier can be carried on: a loop from a bad journal can't hide both.
  assert.deepEqual(shown([a, b], { a: { continues: "b" }, b: { continues: "a" } }), ["a+b"]);
  assert.deepEqual(shown([a, b], { a: { continues: "b" } }), ["a", "b"]);
  assert.deepEqual(shown([d], { d: { continues: "d" } }), ["d"], "a link to itself is no link");

  assert.equal(wordsSaid([thought("h", "My biggest problem is that I never finish my ")], thought("t", "Sentences.")),
    "“My biggest problem is that I never finish my” … “Sentences.”");

  // Notes as changes arrive: kept for a thought that's there, taken away by an empty note ("keep apart").
  let world = { recaps: [], threads: [], thoughts: [a, b], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: false };
  world = apply(world, { type: "thought_noted", thought_id: "b", note: { continues: "a", why: "finishes it" } });
  assert.deepEqual(world.notes, { b: { continues: "a", why: "finishes it" } });
  world = apply(world, { type: "thought_noted", thought_id: "b", note: { why: "finishes it" } });
  assert.deepEqual(world.notes.b, { why: "finishes it" });
  world = apply(world, { type: "thought_noted", thought_id: "b", note: {} });
  assert.deepEqual(world.notes, {});
  world = apply(world, { type: "thought_noted", thought_id: "nope", note: { why: "x" } });
  assert.deepEqual(world.notes, {}, "no note for a thought that isn't there");

  // Kept apart, the second part says its own words again, on the card's last point too (review, 2026-11-01).
  const bill = { recaps: [], threads: [{ id: "T1", title: "Bills", parent_id: null, status: "open", last_point: "I need to pay the electric bill", touched_ms: 0, tags: [] }],
    thoughts: [thought("a", "I need to pay the"), { ...thought("b", "electric bill"), point: "I need to pay the electric bill" }],
    active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: false, notes: { b: { continues: "a" } } };
  const apart = apply(apply(bill, { type: "thought_noted", thought_id: "b", note: {} }), { type: "thought_repointed", thought_id: "b", point: "electric bill" });
  assert.deepEqual([apart.thoughts[1].point, apart.threads[0].last_point], ["electric bill", "electric bill"]);
  // A yes to the first part's "Did you mean" fixes the point that carries it on too, as the core does.
  const asked = { ...bill, thoughts: [{ ...bill.thoughts[0], text: "ask muse bark about", unclear: "muse bark", guess: "Muse Spark" },
    { ...bill.thoughts[1], point: "Ask muse bark about the lease" }] };
  assert.equal(apply(asked, { type: "thought_corrected", thought_id: "a", accept: true }).thoughts[1].point, "Ask Muse Spark about the lease");
  assert.equal(apply({ ...asked, notes: {} }, { type: "thought_corrected", thought_id: "a", accept: true }).thoughts[1].point,
    "Ask muse bark about the lease", "not joined: not touched");
  // "Scratch that" keeps the note, as the core does, so Undo brings the part back joined.
  assert.deepEqual(apply(bill, { type: "thought_skipped", thought_id: "b" }).notes, bill.notes);

  // The header counts ideas, as the cards do: card by card, a carried part isn't one more.
  const onCard = (t) => t.thread_id;
  assert.deepEqual([...carriedIds([a, b, c], { c: { continues: "a" } }, onCard)], ["a"]);
  assert.deepEqual([...carriedIds([a, { ...c, thread_id: "T2" }], { c: { continues: "a" } }, onCard)], [], "not on its card");
  assert.deepEqual([...carriedIds([a, b], {}, onCard)], []);

  // The marks say what the AI did and what a tap does; the map shows them on every point and counts ideas.
  assert.match(CHUNK_TIPS.joined, /pause/);
  assert.match(CHUNK_TIPS.joined, /apart/);
  assert.match(CHUNK_TIPS.assumed, /Move it/, "the reading has no undo, but a wrong place is fixed by Move (moves.rs)");
  for (const tip of Object.values(CHUNK_TIPS)) assert.ok(tip.length > 10 && tip.length <= 120, tip);
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../ui/src/MapCards.tsx", import.meta.url), "utf8");
  assert.match(app, /<PointNote thought=\{thought\} heads=\{heads\} unlink=\{on\.unlink\} \/>/);
  assert.match(app, /\{points\.length\} \{points\.length === 1 \? "thought" : "thoughts"\}/);
  assert.match(app, /return ideaCounts\(world, start, Date\.now\(\)\);/, "the header counts ideas too (recap-check runs ideaCounts)");
  // Each part keeps its own speech fixes; a search lands on the point a part shows in.
  assert.match(app, /heads\.map\(\(head\) => <Fixes key=\{head\.id\} thought=\{head\} on=\{on\} \/>\)/);
  assert.match(app, /data-heads=\{heads\.map/);
  assert.match(readFileSync(new URL("../ui/src/find.ts", import.meta.url), "utf8"), /\[data-heads~=/);
  // Keyboard and screen reader: "keep apart" is in the button's name, focus stays on the point it leaves, and the
  // assumption's tip is reachable by Tab (reviews, 2026-11-01).
  const chunks = readFileSync(new URL("../ui/src/chunks.tsx", import.meta.url), "utf8");
  assert.match(chunks, /aria-label=\{`Joined across a pause; keep apart:/);
  assert.match(chunks, /closest<HTMLElement>\("li\[tabindex\]"\)\?\.focus\(\); unlink\(/, "focus moves before the button goes");
  assert.match(chunks, /className="assumed"[^>]*tabIndex=\{0\}/);
  console.log("Chunks checks passed: parts said across a pause show as one point (chains, links off the card, a part finished twice, cycles), their words, notes as changes arrive, keep apart and fixes on parts, the header's count, search, keyboard paths, and the marks' tips.");
} finally {
  await server.close();
}
