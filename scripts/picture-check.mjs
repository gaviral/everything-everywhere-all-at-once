// No extra dependencies: run with `node scripts/picture-check.mjs`.
// The picture-slot rule (ui/src/pictures.ts): the letter tile until a picture decodes, the next copy when one fails,
// a few spaced fetches and then the tile stays, and one more fetch when the core comes back.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

const server = await uiServer();
try {
  const { start, resume, source, decoded, failed, wait, retried, back, RETRY_MS } = await server.ssrLoadModule("/src/pictures.ts");

  // No picture yet (queued or being drawn): nothing to fetch, the tile shows, and nothing waits or retries.
  const none = start([]);
  assert.equal(source(none), null, "no picture: no image");
  assert.equal(wait(none), null, "no picture: no timer");
  assert.deepEqual(back(none), none, "no picture: the core coming back fetches nothing");

  // A picture that loads: shown only once decoded.
  let slot = start(["/images/T1-palace.webp", "/images/T1-small.webp"]);
  assert.equal(slot.state, "loading");
  assert.equal(source(slot), "/images/T1-palace.webp", "the best copy first");
  assert.equal(decoded(slot).state, "shown");

  // The Palace copy is missing: the map's copy at once, with no wait.
  slot = failed(slot);
  assert.equal(slot.state, "loading");
  assert.equal(source(slot), "/images/T1-small.webp", "then the map's copy");

  // Every copy failed: the tile stays while it waits, then each copy is fetched again, under a new address.
  const fetched = [];
  for (const ms of RETRY_MS) {
    slot = failed(slot);
    assert.equal(slot.state, "waiting");
    assert.equal(source(slot), null, "nothing on screen but the tile while it waits");
    assert.equal(wait(slot), ms);
    slot = retried(slot);
    fetched.push(source(slot));
    slot = failed(slot); // the Palace copy again
  }
  assert.deepEqual(fetched, ["/images/T1-palace.webp?fetch=1", "/images/T1-palace.webp?fetch=2", "/images/T1-palace.webp?fetch=3"]);
  slot = failed(slot);
  assert.equal(slot.state, "gave-up", `capped: ${RETRY_MS.length} spaced fetches, then the tile stays`);
  assert.equal(wait(slot), null, "no more timers");
  assert.equal(RETRY_MS.reduce((a, b) => a + b, 0) <= 60_000, true, "it stops within a minute");

  // The core comes back: one more fetch, which doesn't use up a timed one, and that can show the picture.
  slot = back(slot);
  assert.equal(slot.state, "loading");
  assert.equal(source(slot), "/images/T1-palace.webp?fetch=4");
  assert.equal(decoded(slot).state, "shown", "a picture back after a restart shows");
  assert.equal(failed(failed(slot)).state, "gave-up", "and failing again leaves the tile, with no new timer");

  // A shown or loading picture ignores the core coming back and stray timers.
  const shown = decoded(start(["/images/T2-small.webp"]));
  assert.deepEqual(back(shown), shown);
  assert.deepEqual(retried(shown), shown);
  assert.deepEqual(failed(shown), shown, "a late error for a picture already shown changes nothing");

  // A map picture alone (no Palace copy to try first).
  let map = start(["/images/T3-small.webp"]);
  map = failed(map);
  assert.equal(map.state, "waiting");
  assert.equal(source(retried(map)), "/images/T3-small.webp?fetch=1");
  // A map that kept only its full picture has no Palace copy, so the Palace names the same address twice: it is tried
  // once, and a failure waits for a new fetch instead of "trying" the same address again (no request, no answer, stuck).
  let full = start(["/images/T4-abc.png", "/images/T4-abc.png"]);
  assert.deepEqual(full.sources, ["/images/T4-abc.png"], "a copy named twice is tried once");
  full = failed(full);
  assert.equal(full.state, "waiting", "its failure waits for a new fetch");
  assert.equal(source(retried(full)), "/images/T4-abc.png?fetch=1", "and the new fetch has a new address");
  assert.deepEqual(start(["/b", "/a", "/b"]).sources, ["/b", "/a"], "order kept");

  // A slot mounting again (a card back from the Palace) asks for the address its picture last showed from, which the
  // browser still holds, not the copy that failed before it.
  const again = resume(["/images/T5-small.webp"], { index: 0, fetch: 1 });
  assert.equal(source(again), "/images/T5-small.webp?fetch=1", "the fetch that showed");
  assert.equal(again.state, "loading", "still shown only once it is in the browser and decoded");
  assert.equal(again.timed, 0, "with its timed fetches unused");
  const palace = resume(["/images/T6-palace.webp", "/images/T6-small.webp"], { index: 1, fetch: 0 });
  assert.equal(source(palace), "/images/T6-small.webp", "the copy that showed (a map with no Palace copy)");
  assert.equal(source(retried(failed(palace))), "/images/T6-palace.webp?fetch=1", "if it fails now, every copy again");
  assert.deepEqual(resume(["/images/T7-small.webp"], { index: 3, fetch: 2 }), start(["/images/T7-small.webp"]),
    "a remembered copy that no longer exists starts over");
  assert.deepEqual(resume(["/images/T8-small.webp"]), start(["/images/T8-small.webp"]), "nothing remembered: the start");
  console.log("picture-check: all passed");
} finally {
  await server.close();
}
