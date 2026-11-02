// No extra dependencies: run with `node scripts/send-card-check.mjs`.
// The ready-to-send message card (ui/src/send-card.ts, fed the core's `send_card` messages, core/src/messages.rs):
// a visible countdown in whole seconds from 5, a bar that runs with it, Stop and Esc only while it counts, and an end
// (stopped, sent, dry run, failed) that changes only its own card and stays up for its reading time. The window never
// sends: the core does, only when its own countdown ends (its tests stand in for Messages, so nothing is sent here
// or there).
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { received, secondsLeft, elapsed, nextTick, cardWords, announcement, stopsOnKey, lingerMs, STATE_CLASS } = await server.ssrLoadModule("/src/send-card.ts");
  const { upFor } = await server.ssrLoadModule("/src/notice-rules.ts");
  const text = "Hi Mia, could you confirm what to bring?";
  const msg = (state, extra = {}) => ({ type: "send_card", id: 1, to: "Mia", text, state, in_ms: 0, live: false, message: "", ...extra });
  const t0 = 1_000_000;

  // Counting: 5 at the start, each whole second down, 1 in the last, then "Sending…" (the core sends, not the window).
  let card = received(null, msg("counting", { in_ms: 5000 }), t0);
  assert.equal(card.until, t0 + 5000);
  assert.equal(card.total, 5000);
  const at = (ms) => cardWords(card, t0 + ms);
  assert.deepEqual(at(0), { heading: "Message to Mia · dry run", status: "Sends in 5", stop: true });
  assert.equal(at(1).status, "Sends in 5");
  assert.equal(at(1000).status, "Sends in 4");
  assert.equal(at(4001).status, "Sends in 1");
  assert.deepEqual(at(5000), { heading: "Message to Mia · dry run", status: "Sending…", stop: false }, "no Stop once the count is over");
  assert.equal(secondsLeft(card, t0 + 9000), 0, "never below 0");
  assert.equal(elapsed(card, t0), 0);
  assert.equal(elapsed(card, t0 + 2500), 0.5);
  assert.equal(elapsed(card, t0 + 7000), 1);
  // The digit changes on whole seconds left: from 4.3 s left, the next change is in 0.3 s.
  assert.equal(nextTick(card, t0 + 700), 300);
  assert.equal(nextTick(card, t0 + 1000), 1000);
  assert.equal(nextTick(card, t0 + 5000), 0, "no ticking past the end");
  assert.equal(received(null, msg("counting", { in_ms: 5000, live: true }), t0).live, true);
  assert.equal(cardWords(received(null, msg("counting", { in_ms: 5000, live: true }), t0), t0).heading, "Message to Mia", "a real send says no dry run");
  assert.match(announcement(card), /^Dry run: would send “Hi Mia, could you confirm what to bring\?” to Mia in 5 seconds\. Say stop or press Escape/);

  // Esc stops it only while it counts; other keys, or after the count, do nothing.
  assert.equal(stopsOnKey(card, "Escape", t0 + 4999), true);
  assert.equal(stopsOnKey(card, "Escape", t0 + 5000), false);
  assert.equal(stopsOnKey(card, "Enter", t0), false);
  assert.equal(stopsOnKey(null, "Escape", t0), false);
  assert.equal(lingerMs(card), 0, "a counting card stays until it ends");

  // The end: only for this card; a newer card replaces an older one, and a late end of the older is ignored.
  const stopped = received(card, msg("stopped", { message: "Stopped: not sent" }), t0 + 3000);
  assert.deepEqual(cardWords(stopped, t0 + 3000), { heading: "Message to Mia · dry run", status: "Stopped: not sent", stop: false });
  assert.equal(stopped.total, 5000, "keeps the count's length");
  assert.equal(stopsOnKey(stopped, "Escape", t0 + 3000), false, "nothing left to stop");
  assert.equal(lingerMs(stopped), upFor("Stopped: not sent"), "up for its reading time, as any answer");
  const newer = received(card, { ...msg("counting", { in_ms: 5000 }), id: 2, to: "Sam" }, t0 + 100);
  assert.equal(received(newer, msg("dry_run"), t0 + 5000), newer, "an older card's end leaves the newer up");
  assert.equal(received(null, msg("sent"), t0), null, "an end with no card up shows none");
  const sent = received(card, msg("sent", { live: true, message: "Sent to Mia" }), t0 + 5000);
  assert.equal(cardWords(sent, t0 + 5000).status, "Sent to Mia");
  const dry = received(card, msg("dry_run", { message: "Dry run: nothing sent. With MESSAGES_SEND=on it would have gone to Mia." }), t0 + 5000);
  assert.match(cardWords(dry, t0 + 5000).status, /^Dry run: nothing sent/);
  assert.equal(cardWords(received(card, msg("failed"), t0 + 5000), t0 + 5000).status, "Not sent");
  assert.deepEqual(Object.keys(STATE_CLASS).sort(), ["counting", "dry_run", "failed", "sent", "stopped"]);
  console.log("send-card-check: ok");
} finally {
  await server.close();
}
