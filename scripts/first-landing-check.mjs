// The video's first seconds: the first thought typed on an empty map. Its bubble drifts above the box while the model
// places it (≈ 2.8 s), and must then fly into the card that appears, with no bare canvas between the two. The morning
// walk (2026-11-03) found the bubble fading the instant its thought was placed, while the view that draws the card was
// only just mounting (an empty map has none), and ≈ 0.3 s of nothing before the card.
// Real composer and keys, the built UI in the new shell (?shell=2), a stand-in core that answers as the placer does (a
// new thread, the thought placed on it, touched, active). Every frame from the placing on is read in the page, one
// sample per requestAnimationFrame, so no frame slips between two samples: each is "covered" when the bubble or the
// card is on screen. Four runs as it is (laptop and phone, light and dark), one with the view's code held back 1 s (a
// slow machine: the bubble waits for it and lands) and one held past what a bubble waits (2.8 s: it lets go, and the
// card shows its words as ever). SHOTS=dir saves what the page showed in the frames around the landing; TRACE=1 prints
// every frame; without them nothing is written.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP first-landing-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`first-landing-check: ${error.message}`); process.exit(1); });

/** How long the stand-in core takes to place: the median placing (bubble-flight/index.tsx: 2.8 s measured), so the
 *  bubble has drifted as far as it does for a person. */
const PLACE_MS = 2600;
const WORDS = "Book the cooking class for Mom's birthday";
/** The most a frame may be uncovered, in a row: a frame and a half at 60 Hz. The bubble and the card meet; nothing
 *  between them is bare. */
const HOLE_MS = 40;
/** How long a placed thought's bubble waits for its landing to be drawn (bubble-flight/index.tsx LAND_WAIT_MS). */
const LAND_WAIT_MS = 2000;

const world = {
  threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], proposals: [],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
};
let shown = world;
let thought = null;
let placedAt = 0;
const place = () => {
  const at = Date.now();
  placedAt = at;
  const thread = { id: "T1", title: "Cooking class", parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" };
  shown = { ...shown, threads: [thread], thoughts: [{ ...thought, thread_id: "T1", point: thought.text, placed: true, place_ms: PLACE_MS }], active: "T1", active_by: { you: "T1" } };
  // The placer's own order for a thread it makes: the thread, the landing, the touch, then the move (placer.rs `decide`).
  for (const change of [
    { type: "thread_added", thread },
    { type: "thought_placed", thought_id: thought.id, thread_id: "T1", point: thought.text, unclear: "", complete: true, place_ms: PLACE_MS },
    { type: "thread_touched", thread_id: "T1", last_point: thought.text, at_ms: at },
    { type: "active_changed", thread_id: "T1", speaker: "you" },
  ]) core.send({ type: "change", change });
};
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => {
    if (message.type !== "text") return;
    const at = Date.now();
    thought = { id: "t1", speaker: "you", text: message.text, point: "", thread_id: null, placed: false, unclear: "", guess: "", heard: "", fixed: "",
      complete: true, at_ms: at, place_ms: null, decided: false };
    shown = { ...shown, thoughts: [thought] };
    core.send({ type: "change", change: { type: "thought_added", thought } });
    setTimeout(place, PLACE_MS);
  },
});

/** In the page: one record per frame of what a person could see of the bubble and the card. `at` is epoch ms, so it
 *  lines up with the core's clock here. `held`: the point's words are held back (the slot keeps their place). */
const SAMPLER = `(() => {
  window.__frames = [];
  const seen = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const frame = () => {
    const bubble = document.querySelector(".bubble-flight-bubble");
    const head = document.querySelector(".spine-head[data-thread]");
    const text = document.querySelector(".spine-point[data-thought] .spine-text");
    const words = text?.querySelector(".spine-words");
    const flown = bubble?.querySelector(".bubble-flight-words");
    __frames.push({
      at: performance.timeOrigin + performance.now(),
      hero: !!document.querySelector(".shell-welcome"),
      bubble: bubble ? { o: seen(bubble), air: bubble.hasAttribute("data-flight"), words: flown ? box(flown) : null } : null,
      head: head ? seen(head) : null,
      point: words ? box(words) : null,
      held: text ? getComputedStyle(text).visibility === "hidden" : null,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})()`;

const shots = process.env.SHOTS;
if (shots) mkdirSync(join(shots, "frames"), { recursive: true });
let browser = null;
let runs = 0;
const summary = [];
// `hold`: how long the view's code is held back after the thought is placed, in ms (0: as it comes).
const RUNS = [
  ...[[1440, 900], [390, 844]].flatMap(([width, height]) => ["light", "dark"].map((scheme) => ({ width, height, scheme, hold: 0, what: "" }))),
  { width: 1440, height: 900, scheme: "light", hold: 1000, what: " slow view" },
  { width: 390, height: 844, scheme: "light", hold: 2800, what: " late view" },
];

try {
  for (const { width, height, scheme, hold, what } of RUNS) {
    const label = `${width}x${height} ${scheme}${what}`;
    shown = world;
    thought = null;
    placedAt = 0;
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until, on } = browser;
    // As in cards-esc-check: Page.enable is required for the storage script to run.
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem("e2a2o.toured", "1");
      localStorage.setItem("e2a2o.brick.bubble-flight.hinted", "true");
      window.__errors = [];
      addEventListener("error", e => {
        if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src);
      }, true);
      addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
      const error = console.error;
      console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };
    ` });
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" },
    ] });
    if (hold) {
      // The Spine's code is fetched when the map's first thread asks for it: held back, it comes late, as on a slow machine.
      await page("Fetch.enable", { patterns: [{ urlPattern: "*/assets/spine-*.js", requestStage: "Request" }] });
      on("Fetch.requestPaused", ({ requestId }) => { setTimeout(() => page("Fetch.continueRequest", { requestId }).catch(() => {}), hold); });
    }
    const frames = [];
    if (shots) {
      // What the browser draws, every other frame (≈ 33 ms), from Enter to a little after the landing.
      on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
        frames.push({ at: metadata.timestamp * 1000, data });
        page("Page.screencastFrameAck", { sessionId }).catch(() => {});
      });
    }
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
    assert.ok(await until('!!document.querySelector(".shell-welcome") && !!document.querySelector(".bubble-flight") && !!document.querySelector("#type-a-thought")', 10000),
      `${label}: the empty map opens with its welcome, the composer and the bubble flight mounted`);
    assert.equal(await evaluate('!!document.querySelector(".spine-frame")'), false, `${label}: an empty map has no canvas yet (the view that draws cards mounts with the first thread)`);
    await evaluate("document.fonts.ready.then(() => true)");

    // Type it as a person does: a tap in the box, the words, Enter.
    const at = await evaluate(`(() => { const r = document.querySelector("#type-a-thought").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
    assert.ok(await until('document.activeElement === document.querySelector("#type-a-thought")'), `${label}: a tap puts the cursor in the box`);
    await page("Input.insertText", { text: WORDS });
    await evaluate(SAMPLER);
    if (shots) await page("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 2 });
    for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
    for (let waited = 0; waited < 3000 && !thought; waited += 25) await sleep(25);
    assert.ok(thought && thought.text === WORDS, `${label}: Enter sends the words as typed`);
    assert.ok(await until('!!document.querySelector(".bubble-flight-bubble")', 1500), `${label}: its bubble lifts out of the box`);
    // Held above the box, still on the empty map, until the core answers.
    await sleep(PLACE_MS - 400);
    const waiting = await evaluate(`(() => { const b = document.querySelector(".bubble-flight-bubble"), c = document.querySelector(".composer, [data-slot=stage]").getBoundingClientRect(), r = b?.getBoundingClientRect();
      return { bubble: !!b, above: !!r && r.bottom <= c.top + 1, hero: !!document.querySelector(".shell-welcome"), canvas: !!document.querySelector(".spine-frame") }; })()`);
    assert.deepEqual(waiting, { bubble: true, above: true, hero: true, canvas: false }, `${label}: while it is placed, its bubble hovers above the box over the welcome`);
    if (shots && !hold) {
      const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(shots, `first-landing-waiting-${width}-${scheme}.png`), Buffer.from(data, "base64"));
    }
    for (let waited = 0; waited < 3000 && !placedAt; waited += 25) await sleep(25);
    assert.ok(placedAt, `${label}: the stand-in core placed the thought`);
    assert.ok(await until('!!document.querySelector(".spine-head[data-thread]") && !document.querySelector(".bubble-flight-bubble")', 6000 + hold), `${label}: the card shows and the bubble is gone`);
    await sleep(600);
    if (shots) {
      await page("Page.stopScreencast");
      if (!hold) {
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shots, `first-landing-landed-${width}-${scheme}.png`), Buffer.from(data, "base64"));
      }
      // The browser draws only when something changes, and hands frames over a little out of order: by time, then.
      for (const [i, f] of frames.filter((f) => f.at >= placedAt - 200 && f.at <= placedAt + 900 + hold).sort((a, b) => a.at - b.at).entries()) {
        const ms = Math.round(f.at - placedAt);
        const name = `first-landing${what.replace(" ", "-")}-${width}-${scheme}-${String(i).padStart(2, "0")}-${ms < 0 ? "minus" : "plus"}${String(Math.abs(ms)).padStart(4, "0")}ms.jpg`;
        writeFileSync(join(shots, "frames", name), Buffer.from(f.data, "base64"));
      }
    }

    // What the page showed, frame by frame, from the moment the core placed the thought.
    const all = await evaluate("__frames");
    const from = all.findIndex((f) => f.at >= placedAt - 30);
    assert.ok(from >= 0, `${label}: frames were read around the placing`);
    const run = all.slice(from);
    // TRACE=1 prints each frame: ms after the placing, the bubble's opacity (* in the air), the card's, the welcome.
    if (process.env.TRACE) {
      console.log(`-- ${label}`);
      for (const f of run.slice(0, 120)) console.log(`${String(Math.round(f.at - placedAt)).padStart(5)} ms  bubble ${f.bubble ? f.bubble.o.toFixed(2) + (f.bubble.air ? "*" : " ") : "none"}  card ${f.head === null ? "none" : f.head.toFixed(2)}  words ${f.held === null ? "none" : f.held ? "held" : "shown"}  welcome ${f.hero ? "yes" : "no"}`);
    }
    const cardAt = run.findIndex((f) => f.head !== null && f.head >= 0.4);
    assert.ok(cardAt >= 0, `${label}: the card became visible`);
    if (hold <= LAND_WAIT_MS) {
      const covered = (f) => (f.bubble !== null && f.bubble.o >= 0.4) || (f.head !== null && f.head >= 0.4);
      // The longest stretch before the card's first frame in which neither it nor the bubble is on screen.
      let hole = 0, start = null;
      for (const f of run.slice(0, cardAt + 1)) {
        if (!covered(f)) { start ??= f.at; hole = Math.max(hole, f.at - start); } else start = null;
      }
      if (start !== null) hole = Math.max(hole, run[cardAt].at - start);
      assert.ok(hole <= HOLE_MS, `${label}: nothing but bare canvas for ${Math.round(hole)} ms between the bubble and the card (at most ${HOLE_MS})`);
      // It stayed in the air until the card was there to land on.
      assert.ok(run.slice(0, cardAt + 1).findLast((f) => f.bubble?.air), `${label}: the bubble was still in the air when the card appeared`);
      // The point's words wait for it, as a later thought's do (the slot holds their place): never twice on screen.
      const twice = run.filter((f) => f.bubble?.air && f.head !== null && f.head >= 0.4 && f.held === false);
      assert.deepEqual(twice.map((f) => Math.round(f.at - placedAt)), [], `${label}: the point's words show while its bubble is still in the air (at ms after the placing)`);
      // And it landed on the point's own words.
      const end = run.filter((f) => f.bubble && f.bubble.o >= 0.9 && f.bubble.words && f.point).at(-1);
      assert.ok(end, `${label}: the bubble reached the point with its words showing`);
      assert.ok(Math.abs(end.bubble.words.top - end.point.top) <= 8 && Math.abs(end.bubble.words.left - end.point.left) <= 14,
        `${label}: the bubble's words settle onto the point's (off by ${Math.round(end.bubble.words.left - end.point.left)} px across, ${Math.round(end.bubble.words.top - end.point.top)} up or down)`);
      summary.push(`${label}: card ${Math.round(run[cardAt].at - placedAt)} ms after the placing, ${Math.round(hole)} ms bare`);
    } else {
      // The view came later than a bubble waits for: it let go (no bubble in the air for good), then the card showed.
      const gone = run.findIndex((f) => f.bubble === null || f.bubble.o < 0.05);
      assert.ok(gone >= 0 && run[gone].at < run[cardAt].at, `${label}: the bubble let go before the card came (gone at ${gone >= 0 ? Math.round(run[gone].at - placedAt) : "never"} ms, card at ${Math.round(run[cardAt].at - placedAt)})`);
      const waited = run[gone].at - placedAt;
      assert.ok(waited >= LAND_WAIT_MS - 100 && waited <= LAND_WAIT_MS + 450, `${label}: it waited ${Math.round(waited)} ms for its landing (${LAND_WAIT_MS} ms, and its fade)`);
      assert.equal(run.slice(gone).some((f) => f.bubble && f.bubble.o >= 0.05), false, `${label}: no bubble comes back after it let go`);
      summary.push(`${label}: bubble let go ${Math.round(waited)} ms after the placing, card ${Math.round(run[cardAt].at - placedAt)} ms`);
    }
    // Nothing is left behind: its words show, no slot is held open, no bubble, no error, no broken view, no sideways scroll.
    const after = await evaluate(`(() => { const text = document.querySelector(".spine-point[data-thought] .spine-text");
      return { shown: !!text && getComputedStyle(text).visibility === "visible", slot: !!document.querySelector('[data-slot^="slot:"]'), bubble: !!document.querySelector(".bubble-flight-bubble") }; })()`);
    assert.deepEqual(after, { shown: true, slot: false, bubble: false }, `${label}: the point shows its words, no slot is left open and no bubble in the air`);
    assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors`);
    assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI`);
    assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: no horizontal overflow`);
    runs++;
    await browser.close();
    browser = null;
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
console.log(`first-landing-check: ok (${runs} runs: the first thought on an empty map, typed; its bubble holds above the box while it is placed, stays in the air until the card shows, lands in the slot and settles on the point's words; no bare frame between; laptop and phone, light and dark; a slow view is waited for, a late one let go)`);
if (process.env.VERBOSE) console.log(summary.join("\n"));
