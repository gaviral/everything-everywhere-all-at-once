// No extra dependencies: run with `node scripts/points-check.mjs` (after the UI is built; precheck builds it first).
// Every point stays inside its card, in a real browser with the app's own motion (2026-11-02). In takes, a point that
// had just landed in a new branch was drawn ≈ 100 px under its card for 13–15 s after "Show" on a card above it:
// Point measured its box only when its thread's thoughts changed (layoutDependency), so when its card moved, Motion
// projected it from its old box and the card's move counted twice. This plays that moment on the built UI (ui/dist),
// served with a stand-in core (a snapshot, then the core's changes), in headless Chrome, and measures every point
// against its card on every frame while the cards move, and every point once they settle. Exit 3 (precheck's WARN) when this machine has no Chrome or ui/dist.
import assert from "node:assert/strict";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) {
  console.log(`SKIP points-check: ${why}`);
  process.exit(3);
}

// ---- The map at the moment it went wrong: Rent above Stats in one column, Stats open (the active thread).
const now = Date.now();
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, placed = true) => ({ id, speaker: "you", text, point: placed ? text : "", thread_id, placed, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: placed ? 3000 : null, decided: false });
const world = {
  threads: [thread("T1", "Rent Due Friday"), thread("T2", "Garden Plans"), thread("T3", "Stats Midterm Thursday")],
  thoughts: [thought("a", "Rent is due Friday", "T1"), thought("b", "Plant the tomatoes this weekend", "T2"), thought("c", "Stats midterm is Thursday, chapters four to six", "T3")],
  active: "T3", active_by: { you: "T3" }, suggestions: [],
  actions: [{ id: "ac-1", thread_id: "T1", kind: "reminder", title: "Pay rent", when: "2026-11-06", status: "new", done_ms: null }],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};
// Then a thought arrives (its pending pill), lands in a new branch under Stats, and that branch becomes active.
const said = thought("d", "Study with Priya on Wednesday night", "T3", false);
const later = [
  [{ type: "thought_added", thought: said }, 1500],
  [{ type: "thread_added", thread: thread("T4", "Study With Priya", "T3") }, 0],
  [{ type: "thought_placed", thought_id: "d", thread_id: "T4", point: said.text, unclear: "", guess: "", heard: "", fixed: "", complete: true, place_ms: 3100 }, 0],
  [{ type: "thread_touched", thread_id: "T4", last_point: said.text, at_ms: now }, 0],
  [{ type: "active_changed", thread_id: "T4", speaker: "you" }, 1500],
];

// ---- A stand-in core sending the snapshot and then the changes, and the built UI in headless Chrome.
const core = await standInCore(() => [{ type: "snapshot", world }]);
let page = null;
let failed = null;
try {
  page = await openPage(`http://127.0.0.1:${core.port}/`);
  const { evaluate } = page;
  for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector("#thread-T3 li[id^='point-']")`).catch(() => false)); i++) await sleep(100);
  await sleep(800);
  for (const [change, wait] of later) { core.send({ type: "change", change }); await sleep(wait || 60); }

  // Every point's box (as drawn, transforms included) against its own card's.
  const probe = `[...document.querySelectorAll("li[id^='point-']")].map((li) => {
    const card = li.closest("section.thread"), p = li.getBoundingClientRect(), c = card.getBoundingClientRect();
    return { point: li.id, card: card.id, out: Math.round(Math.max(0, c.top - p.top, p.bottom - c.bottom, c.left - p.left, p.right - c.right)) };
  })`;
  const top = (id) => evaluate(`document.getElementById("${id}").getBoundingClientRect().top`);
  const stray = (points) => points.filter((p) => p.out > 2);
  const before = await evaluate(probe);
  assert.ok(before.some((p) => p.point === "point-d" && p.card === "thread-T4"), `the new point is in its branch card: ${JSON.stringify(before)}`);
  assert.deepEqual(stray(before), [], "every point starts inside its card");

  // "Show" on Rent, above Stats: Stats and its branch move down. Then "Hide": they move back up.
  for (const [step, expect] of [["Show", 1], ["Hide", -1]]) {
    const from = await top("thread-T4");
    // The moved cards' points are measured on every animation frame, from before the click until well after the
    // springs settle (well inside a second; a stray point stayed out for 13–15 s on camera), so a point that strays
    // mid-move and comes back fails too. Rent's own points are checked once it settles: while a card opens or closes
    // its points slide with it and may sit outside it for a moment (43 px here, 0.1–0.4 s in takes), by design.
    await evaluate(`(() => { window.__worst = new Map(); window.__frames = 0; const tick = () => {
      window.__frames++;
      for (const p of ${probe}) if (p.card !== "thread-T1" && p.out > 2 && !(window.__worst.get(p.point)?.out >= p.out)) window.__worst.set(p.point, p);
      window.__raf = requestAnimationFrame(tick); }; tick(); })()`);
    await evaluate(`document.querySelector("#thread-T1 > .thread-head > button.thread-toggle").click()`);
    await sleep(2000);
    const { worst, frames } = await evaluate(`(cancelAnimationFrame(window.__raf), { worst: [...window.__worst.values()], frames: window.__frames })`);
    const moved = (await top("thread-T4")) - from;
    assert.ok(moved * expect > 30, `${step} on Rent moves the branch card (moved ${Math.round(moved)} px)`);
    assert.ok(frames > 30, `${step}: measured on every frame (${frames} frames in 2 s)`);
    assert.deepEqual(worst, [], `during and after ${step} on the card above, every point of the cards it moves stays inside its card (px outside, worst frame)`);
    assert.deepEqual(stray(await evaluate(probe)), [], `after ${step} settles, every point is inside its card`);
  }
} catch (error) {
  failed = error;
} finally {
  await page?.close();
  core.close();
}
if (failed) { console.error(failed.message); process.exit(1); }
console.log("points-check: every point of a moving card stays inside it on every frame, and every point once the cards settle");
