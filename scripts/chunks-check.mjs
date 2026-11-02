// No extra dependencies: run with `node scripts/chunks-check.mjs`.
// Two parts said across a pause show as one point: which thoughts a card shows, the words behind the point, the
// world's notes as changes arrive, and that the marks on a point explain themselves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

globalThis.location = new URL("http://localhost:4321/");
const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { asIdeas, wordsSaid, CHUNK_TIPS } = await server.ssrLoadModule("/src/chunks.tsx");
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

  // The marks say what the AI did and what a tap does; the map shows them on every point and counts ideas.
  assert.match(CHUNK_TIPS.joined, /pause/);
  assert.match(CHUNK_TIPS.joined, /apart/);
  assert.match(CHUNK_TIPS.assumed, /no undo/);
  for (const tip of Object.values(CHUNK_TIPS)) assert.ok(tip.length > 10 && tip.length <= 120, tip);
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<PointNote thought=\{thought\} heads=\{heads\} unlink=\{on\.unlink\} \/>/);
  assert.match(app, /\{points\.length\} \{points\.length === 1 \? "thought" : "thoughts"\}/);
  console.log("Chunks checks passed: parts said across a pause show as one point (chains, links off the card, a part finished twice, cycles), their words, notes as changes arrive, and the marks' tips.");
} finally {
  await server.close();
}
