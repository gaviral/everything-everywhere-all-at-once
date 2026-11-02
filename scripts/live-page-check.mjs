// No extra dependencies: run with `node scripts/live-page-check.mjs` (after the UI is built; precheck builds it first).
// What the core says live, in a real page: the built UI (ui/dist) in headless Chrome over a stand-in core
// (scripts/headless.mjs). The message card (ui/src/send-card.ts, core/src/messages.rs): a count that starts closes
// Recap and Import, whose modal sheets would cover it, so its Stop is on top and a real click reaches it; across a
// dropped connection its bar runs on, a Stop pressed offline rides on the reconnection itself, a card the core no
// longer has goes (also when another window stopped it and a newer one ended), an end said while away shows, and a
// fresh window shows no old end. Live routing (ui/src/route.ts): the landing's tag
// stays readable when the next thought's weighing follows at once, another speaker's active candidate is named, and a
// card a point is dragged over keeps its drop outline. Exit 3 (skipped) when this machine has no Chrome or ui/dist.
import assert from "node:assert/strict";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP live-page-check: ${why}`); process.exit(3); }

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 3000, decided: false });
const world = {
  threads: [thread("T1", "Rent Due Friday"), thread("T2", "Garden Plans")],
  thoughts: [thought("a", "Rent is due Friday", "T1"), thought("b", "Plant the tomatoes this weekend", "T2")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};
const snapshot = { type: "snapshot", world };
const text = "Hi Mia, could you confirm what to bring?";
const card = (id, state, extra = {}) => ({ type: "send_card", id, to: "Mia", text, state, in_ms: 0, live: false, message: "", ...extra });
const OFFLINE = "Not sent: your window was offline, so you couldn't stop it.";

// What a window gets when it connects: the core's catch-up, as each step sets it; null refuses the connection.
let joinReply = [snapshot];
const joins = [];
const core = await standInCore((query) => { joins.push(query.get("stop")); return joinReply; });
let page = null;
let failed = null;
try {
  page = await openPage(`http://127.0.0.1:${core.port}/`);
  const { evaluate, until, page: cdp } = page;
  assert.ok(await until(`!!document.querySelector("#thread-T1")`, 10000), "the map loads");
  const connections = async (n) => { for (let waited = 0; core.connected() < n && waited < 15000; waited += 50) await sleep(50); return core.connected(); };
  const status = () => evaluate(`document.querySelector(".send-card-status")?.textContent ?? null`);
  // Stop, clicked as a person would: a mouse press where it is drawn, which an inert page under a modal never gets.
  const clickStop = async () => {
    const box = await evaluate(`(() => { const b = document.querySelector(".send-card-stop"); if (!b) return null; const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      onTop: b.contains(document.elementFromPoint(x, y)) }; })()`);
    assert.ok(box, "the card offers Stop");
    assert.ok(box.inView, "Stop is in view");
    assert.ok(box.onTop, "nothing covers Stop");
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  };
  const stopsHeard = () => core.heard.filter((m) => m.type === "stop_send").map((m) => m.id);

  // ---- A count that starts closes Recap (night2fix), so its Stop is in view and a real click on it reaches the core.
  await evaluate(`document.querySelector(".recap-button").click()`);
  assert.ok(await until(`!!document.querySelector("dialog.recap-sheet")?.open`), "Recap opens as a modal sheet");
  core.send(card(1, "counting", { in_ms: 5000 }));
  assert.ok(await until(`!document.querySelector("dialog.recap-sheet")?.open`), "the count closes Recap");
  assert.ok(await until(`!!document.querySelector(".send-card-stop")`), "the card is up");
  await clickStop();
  for (let waited = 0; !stopsHeard().includes(1) && waited < 3000; waited += 50) await sleep(50);
  assert.deepEqual(stopsHeard(), [1], "the click reached the core");
  core.send(card(1, "stopped", { message: "Stopped: not sent" }));
  assert.ok(await until(`document.querySelector(".send-card-status")?.textContent === "Stopped: not sent"`));

  // ---- And Import.
  await evaluate(`document.querySelector("button[aria-label='Import chats']").click()`);
  assert.ok(await until(`!!document.querySelector("dialog.import-dialog")?.open`), "Import opens as a modal sheet");
  core.send(card(2, "counting", { in_ms: 5000 }));
  assert.ok(await until(`!document.querySelector("dialog.import-dialog")?.open`), "the count closes Import");
  assert.ok(await until(`!!document.querySelector(".send-card.is-counting .send-card-stop")`));
  const bar = () => evaluate(`document.querySelector(".send-card-bar span")?.style.animationDuration ?? null`);
  assert.equal(await bar(), "5000ms");

  // ---- The connection drops mid-count and comes back while it still counts: the core says the 3 s left, and the bar
  // keeps the count's length, so it runs on from where it was instead of starting over.
  joinReply = [card(2, "counting", { in_ms: 3000 }), snapshot];
  core.drop();
  assert.equal(await connections(1), 1, "the window reconnects");
  await sleep(300);
  assert.equal(await bar(), "5000ms", "the bar keeps the count's length");
  assert.match(await status(), /^Sends in [1-3]$/);

  // ---- Offline, Stop waits and the window says so; the reconnection itself carries it, so the core applies it before
  // the window counts as open (core/src/main.rs `connect`), and only that one.
  joinReply = null;
  core.drop();
  await sleep(300);
  await clickStop();
  assert.ok(await until(`document.body.textContent.includes("your Stop goes as soon as this window reconnects")`), "the window says the Stop waits");
  joins.length = 0;
  joinReply = [card(2, "stopped", { message: "Stopped: not sent" }), snapshot];
  assert.equal(await connections(1), 1, "the window reconnects");
  assert.equal(joins.at(-1), "2", "the reconnection carries the Stop");
  assert.ok(await until(`document.querySelector(".send-card-status")?.textContent === "Stopped: not sent"`), "its end shows");
  joins.length = 0;
  core.drop();
  assert.equal(await connections(1), 1);
  assert.deepEqual(joins.slice(-1), [null], "once applied, the Stop isn't carried again");
  assert.ok(!core.heard.some((m) => m.type === "stop_send" && m.id === 2), "nor sent as a message");

  // ---- The core restarted mid-count: its catch-up says nothing about the card, which goes (never stuck on Sending…).
  core.send(card(3, "counting", { in_ms: 5000 }));
  assert.ok(await until(`!!document.querySelector(".send-card.is-counting")`));
  joinReply = [snapshot];
  core.drop();
  assert.equal(await connections(1), 1);
  assert.ok(await until(`!document.querySelector(".send-card")`), "a count the core no longer has goes");

  // ---- Away mid-count, another window stopped it and a newer one ended: the core repeats the newer end, so this
  // window's card is over and goes (never stuck on Sending…), and the newer end, never seen here, doesn't show.
  core.send(card(5, "counting", { in_ms: 5000 }));
  assert.ok(await until(`!!document.querySelector(".send-card.is-counting")`));
  joinReply = [card(6, "dry_run", { message: "Dry run: nothing sent." }), snapshot];
  core.drop();
  assert.equal(await connections(1), 1);
  assert.ok(await until(`!document.querySelector(".send-card")`), "an obsolete count goes");

  // ---- The count ended while the window was away (here: no window of theirs open, so it didn't send): it shows how.
  core.send(card(4, "counting", { in_ms: 5000 }));
  assert.ok(await until(`!!document.querySelector(".send-card.is-counting")`));
  joinReply = [card(4, "stopped", { message: OFFLINE }), snapshot];
  core.drop();
  assert.equal(await connections(1), 1);
  assert.ok(await until(`document.querySelector(".send-card-status")?.textContent === ${JSON.stringify(OFFLINE)}`), "the end said while away shows");

  // ---- A fresh window (a reload) doesn't show an old end.
  joinReply = [card(4, "dry_run", { message: "Dry run: nothing sent." }), snapshot];
  await cdp("Page.reload", {});
  assert.ok(await until(`!!document.querySelector("#thread-T1")`, 10000));
  await sleep(500);
  assert.equal(await evaluate(`!!document.querySelector(".send-card")`), false, "nothing old on a fresh window");

  // ---- Live routing: a turn said in two parts lands its first and weighs its second at once. The landing's tag stays
  // until read (route.ts `holdMs`: 1.3 s for "here"); the card it landed on is now the speaker's active, and a candidate.
  const decided = { stage: "decided", thought_id: "x", path: ["T2"], new: false, skipped: false, pick: { action: "continue", thread_id: "T2" }, rule: null, why: "names the garden", lane: 0, lanes: 2, ms: 2100 };
  // The tag's own words (the screen-reader words after them are the race line).
  const tag = (id) => evaluate(`document.querySelector("#thread-${id} > .route-tag")?.firstChild?.textContent ?? null`);
  core.send({ type: "route", route: decided });
  core.send({ type: "route", route: { stage: "weighing", thought_id: "y", candidates: [{ thread_id: "T2", why: "active" }, { thread_id: "T1", why: "active" }], lanes: 2 } });
  await sleep(400);
  assert.equal(await tag("T2"), "here", "the landing's tag is still there to read");
  // Once read, the card is a candidate: another speaker's active (this window's own is T1) is named, the window's own isn't.
  assert.ok(await until(`document.querySelector("#thread-T2 > .route-tag")?.firstChild?.textContent === "active"`, 3000), "another speaker's active is named");
  assert.equal(await tag("T1"), null, "this window's own active has its chip, no tag");

  // A point dragged over a lit card: its drop outline (solid) wins over the routing's (dashed).
  const outline = await evaluate(`(() => { const c = document.querySelector("#thread-T1"); c.classList.add("drop-over"); const s = getComputedStyle(c);
    const o = { style: s.outlineStyle, lit: c.classList.contains("route-candidate") }; c.classList.remove("drop-over"); return o; })()`);
  assert.deepEqual(outline, { style: "solid", lit: true }, "the drop outline shows on a card the placer weighs");
} catch (error) {
  failed = error;
} finally {
  await page?.close();
  core.close();
}
if (failed) { console.error(failed.stack ?? failed.message); process.exit(1); }
console.log("live-page-check: ok");
