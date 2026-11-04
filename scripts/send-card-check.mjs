// No extra dependencies: run with `node scripts/send-card-check.mjs`.
// The ready-to-send message card (ui/src/send-card.ts, fed the core's `send_card` messages, core/src/messages.rs):
// a visible countdown in whole seconds from 5, a bar that runs with it, Stop and Esc only while it counts, and an end
// (stopped, sent, dry run, failed) that changes only its own card and stays up for its reading time. The window never
// sends: the core does, only when its own countdown ends (its tests stand in for Messages, so nothing is sent here
// or there).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { received, caughtUp, secondsLeft, elapsed, nextTick, cardWords, announcement, stopsOnKey, lingerMs, STATE_CLASS, comesFirst, STOP_WAITS } = await server.ssrLoadModule("/src/send-card.ts");
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

  const waiting = { ...card, stopPending: true };
  assert.equal(cardWords(waiting, t0).status, STOP_WAITS, "offline Stop is explained in its own card");
  assert.equal(cardWords(waiting, t0).stop, false, "the same Stop cannot be submitted twice");
  assert.equal(announcement(waiting), STOP_WAITS);
  assert.equal(stopsOnKey(waiting, "Escape", t0), false);
  assert.equal(received(waiting, msg("stopped"), t0).stopPending, undefined, "the core's reply retires the local waiting state");

  // The end: only for this card; a newer card replaces an older one, and a late end of the older is ignored.
  const stopped = received(card, msg("stopped", { message: "Stopped: not sent" }), t0 + 3000);
  assert.deepEqual(cardWords(stopped, t0 + 3000), { heading: "Message to Mia · dry run", status: "Stopped: not sent", stop: false });
  assert.equal(stopped.total, 5000, "keeps the count's length");
  assert.equal(stopsOnKey(stopped, "Escape", t0 + 3000), false, "nothing left to stop");
  assert.equal(lingerMs(stopped), upFor(`${cardWords(stopped, stopped.until).heading} ${stopped.text} Stopped: not sent`), "up for its reading time, as any answer");
  const newer = received(card, { ...msg("counting", { in_ms: 5000 }), id: 2, to: "Sam" }, t0 + 100);
  assert.equal(received(newer, msg("dry_run"), t0 + 5000), newer, "an older card's end leaves the newer up");
  // The core repeats the speaker's last end on every (re)connection (core/src/messages.rs `card_for`): a fresh window
  // shows nothing old; one that was counting that card down while its connection was away learns how it went.
  assert.equal(received(null, msg("sent", { live: true, message: "Sent to Mia" }), t0), null, "a fresh window shows no old end");
  const late = received(card, msg("sent", { live: true, message: "Sent to Mia" }), t0 + 9000);
  assert.equal(late.state, "sent");
  assert.equal(cardWords(late, t0).status, "Sent to Mia");
  assert.equal(lingerMs(late), upFor(`${cardWords(late, late.until).heading} ${late.text} Sent to Mia`));
  assert.equal(received(late, msg("sent", { live: true, message: "Sent to Mia" }), t0 + 9500), late, "the same end again: its time up doesn't start over");
  // Back mid-count, the core says the time left: the bar keeps the count's length, so it runs on from where it was.
  const back = received(card, msg("counting", { in_ms: 3000 }), t0 + 2000);
  assert.equal(back.total, 5000, "the count's length");
  assert.equal(back.until, t0 + 5000);
  assert.equal(elapsed(back, t0 + 2000), elapsed(card, t0 + 2000), "the bar where it was");
  // The core sends the card before the snapshot: one still counting that it didn't name goes (it restarted, or another
  // window stopped it and a newer one ended since, whose end is what the core repeats); an end still up stays.
  assert.equal(caughtUp(card, null), null, "never stuck on Sending…");
  assert.equal(caughtUp(card, 1), card);
  assert.equal(caughtUp(received(card, { ...msg("dry_run"), id: 2 }, t0 + 9000), 2), null, "another card's end: this one is over");
  assert.equal(caughtUp(late, null), late);
  assert.equal(caughtUp(null, null), null);
  const sent = received(card, msg("sent", { live: true, message: "Sent to Mia" }), t0 + 5000);
  assert.equal(cardWords(sent, t0 + 5000).status, "Sent to Mia");
  const dry = received(card, msg("dry_run", { message: "Dry run: nothing sent. With MESSAGES_SEND=on it would have gone to Mia." }), t0 + 5000);
  assert.match(cardWords(dry, t0 + 5000).status, /^Dry run: nothing sent/);
  assert.equal(cardWords(received(card, msg("failed"), t0 + 5000), t0 + 5000).status, "Not sent");
  assert.deepEqual(Object.keys(STATE_CLASS).sort(), ["counting", "dry_run", "failed", "running", "sent", "stopped"]);

  const running = received(card, msg("running", { purpose: "helpers", to: "3 helpers", message: "Coding helpers running" }), t0 + 6000);
  assert.equal(cardWords(running, t0 + 9000).stop, true, "running helpers retain Stop");
  assert.equal(stopsOnKey(running, "Escape", t0 + 9000), true);
  assert.equal(lingerMs(running), 0, "running helpers do not expire");
  assert.equal(caughtUp(running, null), null, "a stale running card is cleared after reconnect");
  assert.equal(received(null, msg("running", { purpose: "helpers" }), t0).state, "running", "running card replays to a fresh window");
  assert.equal(comesFirst(running), true);
  assert.equal(received(running, msg("stopped"), t0 + 9000).state, "stopped");

  // A modal sheet (Recap, Import) makes the rest of the window inert and covers it: a message that starts counting
  // closes them, so its countdown and Stop are in view and clickable while it can still be stopped (the sheet says
  // "Say 'map' to close", so the mic is on behind it). Only a new count does; its end leaves a sheet opened since alone.
  assert.equal(comesFirst(card), true);
  for (const ended of [stopped, sent, dry, late]) assert.equal(comesFirst(ended), false, ended.state);
  assert.equal(comesFirst(null), false);
  assert.match(src("core.ts"), /case "send_card": \{[^}]*comesFirst\([^)]*\)\) closeRecap\(\)/, "Recap closes for a counting card");
  assert.match(src("Import.tsx"), /comesFirst\(core\.sendCard\)\) setOpen\(false\)/, "Import closes for a counting card");
  console.log("send-card-check: ok");
} finally {
  await server.close();
}
