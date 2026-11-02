// No extra dependencies: run with `node scripts/lane-check.mjs` (after the UI is built; precheck builds it first).
// Full's cards up at once, in a real page: the built UI (ui/dist) in headless Chrome over a stand-in core
// (scripts/headless.mjs). Ten pull requests (ui/src/PullsCard.tsx), a long note (NoteCard.tsx) and a message counting
// down (SendCard.tsx) share the notice lane's room between the Apps pill and the dock: none runs under the composer or
// off the screen, none covers another, and each card's ×, its title, the note's status and the message's Stop stay
// on top where they're drawn. On a laptop at the page's top and scrolled, and on a phone, where the cards are in the
// page's flow and the map scrolls under them. Before (connectors, 2026-11-02), the note card ran past a 900 px window
// and the GitHub card covered the composer; on a phone the cards stuck on top of each other and the note card covered
// the message's Stop. And the cards' holds: with focus in the note card, the pointer crossing it to the GitHub card
// doesn't let it go (it closed under the focus, as the GitHub card once did); after either is closed by its ×, the
// next one goes on its own (it stayed up for good). Exit 3 (skipped) when this machine has no Chrome or ui/dist.
import assert from "node:assert/strict";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP lane-check: ${why}`); process.exit(3); }

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 3000, decided: false });
// Enough threads that a laptop's page scrolls: the lane sits under the Apps pill at the top, under the header past it.
const titles = ["Hackathon plan", "Rent Due Friday", "Garden Plans", "Picnic at the lake", "Demo recording", "README sections", "Submission checklist", "Group project", "Groceries", "Gym schedule", "Trip to Lisbon", "Book club"];
const threads = Array.from({ length: 30 }, (_, i) => thread(`T${i + 1}`, titles[i] ?? `Topic ${i + 1}`));
const world = {
  threads, thoughts: threads.flatMap((t, i) => [thought(`a${i}`, `${t.title}: the first point`, t.id), thought(`b${i}`, `${t.title}: one more point to say`, t.id)]),
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};

// The GitHub card at its longest: ten rows, two titles that wrap, and more on GitHub.
const pull = (number, title) => ({ number, title, state: "open", checks: "passing", failing: 0, total: 2, updated: new Date(now - (140 - number) * 3_600_000).toISOString(), url: `https://github.com/acme/garden-planner/pull/${number}` });
const pulls = (id) => ({ type: "pulls_card", id, title: "Open pull requests", repo: "acme/garden-planner", state: "ready", more: true, message: "", pulls: [
  pull(131, "Water the raised beds on a schedule that follows the week's rain forecast instead of a fixed timer"), pull(130, "Frost dates for the north beds"),
  pull(129, "Seed list export as a printable sheet"), pull(128, "Compost reminders follow the season"),
  pull(127, "Share a bed plan with a neighbour by link, read-only, with an expiry the owner picks"), pull(125, "Tidy the plant names on the shopping list"),
  pull(124, "Sun hours per bed from the garden's orientation"), pull(122, "Companion planting hints when two crops share a bed"),
  pull(120, "Harvest log with weights per bed and a season total"), pull(118, "Dark mode for the bed map"),
] });
// A note past its body's nine points: sixteen, under four headings.
const point = (text) => ({ text, who: "", decided: false, unfinished: false });
const section = (title, n) => ({ title, points: Array.from({ length: n }, (_, i) => point(`${title || "Plan"}: point ${i + 1} of the thread, said once`)) });
const note = (id) => ({ type: "note_card", id, title: "Hackathon plan", state: "dry_run", live: false, sections: [section("", 4), section("Demo recording", 4), section("README", 4), section("Submission", 4)],
  message: "Dry run: nothing written. With NOTES_WRITE=on this would be a new note in Notes." });
// Counting for a minute, so it's still up to stop while the check looks (the core's real count is 5 s).
const send = { type: "send_card", id: 1, to: "Mia", text: "Hi Mia, could you confirm what to bring?", state: "counting", in_ms: 60_000, live: false, message: "" };

/** Where each card is and whether each control is on top where it's drawn (what a click there would reach). */
const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const onTop = (e) => { if (!e) return "missing"; const b = e.getBoundingClientRect(); const x = b.left + Math.min(b.width / 2, 24), y = b.top + b.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return "off screen";
    const hit = document.elementFromPoint(x, y); return hit && (hit === e || e.contains(hit)) ? "ok" : "under " + (hit?.closest("[class]")?.className ?? hit?.tagName); };
  const cards = {};
  for (const [name, selector] of [["message", ".send-card"], ["GitHub", ".pulls-card"], ["note", ".note-card"]]) if (q(selector)) cards[name] = box(q(selector));
  return { scrollY: Math.round(scrollY), composer: box(q("#type-a-thought")), cards, noteBody: q(".note-card-body") ? Math.round(q(".note-card-body").getBoundingClientRect().height) : 0,
    on: { "the composer": onTop(q("#type-a-thought")), "the message's Stop": q(".send-card") ? onTop(q(".send-card-stop")) : null, "the message's words": q(".send-card") ? onTop(q(".send-card-text")) : null,
      "the GitHub card's ×": onTop(q(".pulls-card-close")), "the GitHub card's title": onTop(q(".pulls-card-title")), "the first pull request": onTop(q(".pulls-card-row")),
      "the note card's ×": onTop(q(".note-card-close")), "the note's title": onTop(q(".note-card-title")), "the note's status": onTop(q(".note-card-status")) } };
})()`;

function together(where, m, names, { underDock = false } = {}) {
  const at = `${where} (scrolled ${m.scrollY})`;
  assert.deepEqual(Object.keys(m.cards), names, `${at}: the cards up`);
  const cards = Object.entries(m.cards);
  // In the page's flow on a phone, the cards' foot can be under the dock until the map scrolls: the dock stays on top.
  if (!underDock) for (const [name, b] of cards) assert.ok(b.bottom <= m.composer.top, `${at}: the ${name} card ends at ${b.bottom}, over the composer at ${m.composer.top}`);
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const [a, A] = cards[i], [b, B] = cards[j];
    assert.ok(A.bottom <= B.top || B.bottom <= A.top || A.right <= B.left || B.right <= A.left, `${at}: the ${a} card (${A.top}-${A.bottom}) and the ${b} card (${B.top}-${B.bottom}) overlap`);
  }
  for (const [what, state] of Object.entries(m.on)) {
    if (state === null || (underDock && /status/.test(what))) continue;
    assert.equal(state, "ok", `${at}: ${what} is ${state}`);
  }
  // The note keeps two points in view (the rest scroll inside it).
  if (!underDock) assert.ok(m.noteBody >= 40, `${at}: the note shows ${m.noteBody} px of its points`);
}

const core = await standInCore(() => [{ type: "snapshot", world }]);
let failed = null;
try {
  for (const [where, width, height] of [["a laptop", 1440, 900], ["a phone", 390, 844]]) {
    const page = await openPage(`http://127.0.0.1:${core.port}/`, { width, height });
    try {
      const { evaluate, until } = page;
      assert.ok(await until(`!!document.querySelector("#thread-T1")`, 10000), "the map loads");
      await evaluate(`localStorage.setItem("e2a2o.toured", "1")`);
      await page.page("Page.reload", {});
      assert.ok(await until(`!!document.querySelector("#thread-T1") && !document.querySelector(".tour-tip")`, 10000), "the map loads, toured");
      const phone = width < 560;
      const look = async (y) => { await evaluate(`scrollTo(0, ${y})`); await sleep(250); return evaluate(MEASURE); };
      // Scrolled far enough that the lane sticks under the header (a laptop's is 62 px lower at the page's top).
      const scrolled = async () => { const m = await look(phone ? 600 : 400); assert.ok(m.scrollY >= 100, `${where}: the page scrolls (${m.scrollY})`); return m; };

      // The GitHub card and the note card.
      core.send(pulls(1));
      core.send(note(1));
      assert.ok(await until(`!!document.querySelector(".pulls-card.is-ready") && !!document.querySelector(".note-card")`), `${where}: both cards up`);
      together(`${where}, GitHub and note, at the top`, await look(0), ["GitHub", "note"], { underDock: phone });
      together(`${where}, GitHub and note, scrolled`, await scrolled(), ["GitHub", "note"]);

      // And a message counting down, whose Stop must stay in reach above all.
      core.send(send);
      core.send(note(2));
      assert.ok(await until(`!!document.querySelector(".send-card.is-counting") && !!document.querySelector(".note-card")`), `${where}: the message card up`);
      together(`${where}, all three, at the top`, await look(0), ["message", "GitHub", "note"], { underDock: phone });
      together(`${where}, all three, scrolled`, await scrolled(), ["message", "GitHub", "note"]);
      // The Apps pill stays readable at the top (frames-check: the lane comes after it).
      await look(0);
      if (!phone) assert.equal(await evaluate(`(() => { const e = document.querySelector(".apps-title"); const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.left + 20, b.top + b.height / 2)); })()`), true, `${where}: the Apps pill is on top`);
      core.send({ ...send, state: "stopped", message: "Stopped: not sent" });
    } finally {
      await page.close();
    }
  }

  // Focus holds a card apart from the pointer: Tab from the GitHub card into the note card, then the pointer crosses the
  // note on its way to the GitHub card. A saved note's time up is about 5.5 s; held, it's still there well after.
  const page = await openPage(`http://127.0.0.1:${core.port}/`);
  try {
    const { evaluate, until, page: cdp } = page;
    assert.ok(await until(`!!document.querySelector("#thread-T1")`, 10000), "the map loads");
    core.send({ ...pulls(9), pulls: pulls(9).pulls.slice(0, 1), more: false });
    core.send({ type: "note_card", id: 9, title: "Bills", state: "saved", live: true, message: "Saved to Notes", sections: [section("", 1)] });
    assert.ok(await until(`!!document.querySelector(".pulls-card.is-ready") && !!document.querySelector(".note-card")`), "both cards up");
    await evaluate(`document.querySelector(".pulls-card-row").focus()`);
    for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate(`document.activeElement.getAttribute("aria-label")`), "Close the note card", "Tab goes from the GitHub card to the note card's ×");
    const corner = (selector) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left + 30, y: b.top + 10 }; })()`);
    for (const selector of [".note-card-head", ".pulls-card-head"]) {
      const { x, y } = await corner(selector);
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sleep(150);
    }
    await sleep(7000);
    assert.ok(await evaluate(`!!document.querySelector(".note-card")`), "the note card stays while focus is in it, after the pointer has left it");
    assert.equal(await evaluate(`document.activeElement.getAttribute("aria-label")`), "Close the note card", "and focus stays where it was");

    // Each closed by a click on its ×: a card that goes never says leave or blur, so the next ones must start unheld
    // and go on their own (they stayed up for good).
    for (const close of [".note-card-close", ".pulls-card-close"]) {
      const { x, y } = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(close)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      assert.ok(await until(`!document.querySelector(${JSON.stringify(close)})`, 2000), `${close} closes its card`);
    }
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 700 });
    core.send({ ...pulls(10), pulls: pulls(10).pulls.slice(0, 1), more: false });
    core.send({ type: "note_card", id: 10, title: "Bills", state: "saved", live: true, message: "Saved to Notes", sections: [section("", 1)] });
    assert.ok(await until(`!!document.querySelector(".pulls-card.is-ready") && !!document.querySelector(".note-card")`), "the next cards come");
    assert.ok(await until(`!document.querySelector(".pulls-card") && !document.querySelector(".note-card")`, 12000),
      `after a × each next card goes on its own (still up: ${await evaluate(`[".pulls-card", ".note-card"].filter((s) => document.querySelector(s)).join(", ")`)})`);
  } finally {
    await page.close();
  }
} catch (error) {
  failed = error;
} finally {
  core.close();
}
if (failed) { console.error(failed.stack ?? failed.message); process.exit(1); }
console.log("lane-check: ok");
