// A bubble the canvas floats (a lone aside: one thought on its own) is whole on screen or not shown, never sliced by the
// screen's edge. The demo QA walk found "…ot sent yet", half a bubble at the left edge of a laptop: from the first words of
// the pitch, a canvas whose view follows the topic you're on leaves a bubble's far end past the window, and a closed shape
// cut through reads as a fault, not as "there is more this way". Edge chips (cues.tsx) were whole by construction; this
// holds both, on the built UI in headless Chrome over a stand-in core, with the QA's own story on the map (Mom's birthday,
// the stats midterm, and rent, one thought alone, to the left):
//  - at 1440 × 900 and 390 × 844, light and dark: every aside is whole in its frame, or hidden (not drawn, not pressable);
//    the rent aside is cut at the left on arrival, so it is hidden there (the rule is exercised, not assumed);
//  - drag the canvas so the aside comes whole: it is shown, and a press at its middle is its own; drag it back out: it goes;
//  - a bubble held in the hand (dragged, as to the shelf) stays drawn wherever it is taken, half past the edge too;
//  - edge chips (cues.tsx), the same sizes: something new lands far off to the left, the right, above and below; there is a
//    chip on each of the four edges (at 1440; on a phone, one row with the way to go), each whole in the screen, none cut.
// SHOTS=<folder> also saves a screenshot of each scene there.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP edge-whole-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`edge-whole-check: ${error.stack ?? error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const now = Date.now();
const ago = (s) => now - s * 1000;
const thread = (id, title, secAgo) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: ago(secAgo), tags: [], picture: null, dropped_by: "" });
const thought = (id, text, point, thread_id, secAgo, extra = {}) => ({ id, speaker: "you", text, point, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: ago(secAgo), place_ms: 2800, decided: false, ...extra });
// The pitch's story as the QA walk had it: the first topic dropped, rent on its own, then Mom's birthday and the midterm.
const world = {
  threads: [{ ...thread("T1", "What to build", 200), status: "dropped", dropped_by: "you" }, thread("T2", "Rent", 150), thread("T3", "Mom's birthday", 100), thread("T4", "Stats midterm", 60)],
  thoughts: [
    thought("th-1", "What should I build for this hackathon?", "What to build for this hackathon", "T1", 190),
    thought("th-3", "Oh, and rent is due Friday. I still haven't sent it.", "Rent due Friday, not sent yet", "T2", 150),
    thought("th-4", "Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street.", "Mom's birthday Saturday; pottery class on Main Street", "T3", 100),
    thought("th-5", "Decided: if it's under eighty dollars, I'm booking it tonight.", "Decided: book it tonight if under $80", "T3", 80, { decided: true }),
    thought("th-6", "My stats midterm is Thursday.", "Stats midterm Thursday", "T4", 60),
    thought("th-7", "Decided: I'll study with Partner on Wednesday.", "Decided: study with Partner Wednesday", "T3", 40, { decided: true }),
  ],
  active: "T4", active_by: { you: "T4" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [],
};

/** Every aside as drawn, in the page: its bubble's box, whether it's marked, how it shows, and what answers a press at its middle. */
const asides = `(() => [...document.querySelectorAll(".spine-aside")].map((el) => {
  const face = el.querySelector(".spine-aside-face"), r = face.getBoundingClientRect(), style = getComputedStyle(el);
  const frame = document.querySelector(".spine-frame").getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
  return { text: face.textContent.trim(), box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, frame: { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom },
    marked: el.hasAttribute("data-edge"), opacity: Number(style.opacity), pressable: style.pointerEvents !== "none" && !!hit && face.contains(hit) };
}))()`;

/** How much of its box lies inside `frame`, 0 to 1. */
const shown = ({ box: b, frame: f }) => {
  const w = Math.max(0, Math.min(b.right, f.right) - Math.max(b.left, f.left)), h = Math.max(0, Math.min(b.bottom, f.bottom) - Math.max(b.top, f.top));
  return (w * h) / ((b.right - b.left) * (b.bottom - b.top));
};
const whole = (a) => shown(a) >= 0.98;
/** The rule: whole and drawn, or hidden (not drawn, not pressable); never a sliced bubble in between. */
function holds(label, list) {
  assert.ok(list.length > 0, `${label}: asides on the canvas`);
  for (const a of list) {
    const where = `${label}: "${a.text}"`;
    if (whole(a)) assert.ok(!a.marked && a.opacity > 0.9 && a.pressable, `${where} is whole, so it is drawn and pressable (${JSON.stringify(a)})`);
    else assert.ok(a.marked && a.opacity === 0 && !a.pressable, `${where} is cut by the edge (${Math.round(shown(a) * 100)}% in view), so it must be hidden (${JSON.stringify(a)})`);
  }
}


/** Every edge chip as drawn: its box, the edge it sits on (its class), and its words. */
const chips = `(() => [...document.querySelectorAll(".spine-cue")].map((b) => {
  const r = b.getBoundingClientRect(), edge = (b.className.match(/spine-cue-(left|right|top|bottom|row)/) ?? [])[1];
  return { text: b.textContent.trim(), edge, box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, width: innerWidth, height: innerHeight };
}))()`;

/** The far world: a first topic you're on, and four others each far off in its own direction (one point apiece). */
const farWorld = (() => {
  const titles = { R: "Rent is due", D: "Group project", U: "Electric bill", L: "Stats midterm" };
  const at = { R: [1500, 0], D: [0, 1500], U: [0, -1500], L: [-1500, 0] };
  return {
    titles,
    world: {
      threads: [thread("T0", "Hackathon plan", 90), ...Object.entries(titles).map(([k, title]) => thread(`T${k}`, title, 80))],
      thoughts: [thought("a0", "Deadline tomorrow 9 PM, need to record demo", "Deadline tomorrow", "T0", 60),
        ...Object.keys(titles).map((k, i) => thought(`${k}1`, `First thought on ${titles[k]}`, `First thought on ${titles[k]}`, `T${k}`, 50 - i))],
      active: "T0", active_by: { you: "T0" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [],
      // A topic placed by hand is placed by its thread's id: each of the four far away, in its own direction.
      positions: Object.fromEntries(Object.entries(at).map(([k, [x, y]]) => [`T${k}`, { x, y, by: "you", at_ms: now }])),
    },
  };
})();
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const phone = width === 390;
    const core = await standInCore(() => [{ type: "snapshot", world }]);
    const browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    try {
      // Without Page.enable Chrome accepts a new-document script and never runs it.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1");` });
      for (const scheme of ["light", "dark"]) {
        const label = `${width} ${scheme}`;
        await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: shots ? 2 : 1, mobile: phone });
        await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
        await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
        assert.ok(await until(`!!document.querySelector(".spine-ready") && !!document.querySelector(".spine-aside")`, 10000), `${label}: the canvas opens with an aside on it`);
        await evaluate(`document.fonts.ready.then(() => true)`);
        await sleep(700); // the frame fades in, an aside's own fade, the observer's first report
        const snap = async (name) => {
          if (!shots) return;
          const shot = await page("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(shots, `${name}-${width}-${scheme}.png`), Buffer.from(shot.data, "base64"));
        };
        const opening = await evaluate(asides);
        holds(`${label}, on arrival`, opening);
        assert.ok(opening.some((a) => !whole(a)), `${label}: an aside is past the edge on arrival, as the QA found it (${JSON.stringify(opening.map((a) => [a.text, Math.round(shown(a) * 100)]))})`);
        await snap("aside-on-arrival");

        // A hand takes the canvas the way the aside lies: it comes whole and shows; taken back, it goes.
        const cut = opening.find((a) => !whole(a));
        const pastLeft = cut.box.left < cut.frame.left, pastRight = cut.box.right > cut.frame.right;
        const by = pastLeft ? cut.frame.left - cut.box.left + 40 : pastRight ? cut.frame.right - cut.box.right - 40 : 0;
        const drag = async (dx) => {
          // The camera drag must start on the pane, not on a newly expanded card.
          const origin = await evaluate(`(() => {
            for (const y of [innerHeight * .25, innerHeight * .4, innerHeight * .55, innerHeight * .7])
              for (const x of [innerWidth * .5, innerWidth * .2, innerWidth * .8])
                if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
            return null;
          })()`);
          assert.ok(origin, `${label}: an uncovered pane point for camera drag`);
          const y = origin.y;
          const from = origin.x;
          await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: from, y });
          await page("Input.dispatchMouseEvent", { type: "mousePressed", x: from, y, button: "left", buttons: 1, clickCount: 1 });
          for (let step = 1; step <= 8; step++) await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: from + (dx * step) / 8, y, button: "left", buttons: 1 });
          await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: from + dx, y, button: "left", buttons: 0, clickCount: 1 });
          await sleep(900);
        };
        if (by) {
          await drag(by);
          const panned = await evaluate(asides);
          holds(`${label}, panned`, panned);
          const same = panned.find((a) => a.text === cut.text);
          assert.ok(whole(same) && same.opacity > 0.9 && same.pressable, `${label}: dragged into view, "${cut.text}" is whole and shown (${JSON.stringify(same)})`);
          await snap("aside-whole");
          // In the hand it stays: taken half out of the window it is still drawn; put back and let go, it is whole and shown.
          const grab = { x: (same.box.left + same.box.right) / 2, y: (same.box.top + same.box.bottom) / 2 };
          const out = { x: same.frame.left + 6, y: grab.y };
          await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: grab.x, y: grab.y });
          await page("Input.dispatchMouseEvent", { type: "mousePressed", x: grab.x, y: grab.y, button: "left", buttons: 1, clickCount: 1 });
          for (let step = 1; step <= 10; step++) await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: grab.x + ((out.x - grab.x) * step) / 10, y: grab.y, button: "left", buttons: 1 });
          await sleep(500);
          const held = (await evaluate(asides)).find((a) => a.text === cut.text);
          assert.ok(!whole(held) && !held.marked && held.opacity > 0.9, `${label}: held half out of the window, "${cut.text}" is still drawn (${Math.round(shown(held) * 100)}% in view; ${JSON.stringify(held)})`);
          for (let step = 9; step >= 0; step--) await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: grab.x + ((out.x - grab.x) * step) / 10, y: grab.y, button: "left", buttons: 1 });
          await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: grab.x, y: grab.y, button: "left", buttons: 0, clickCount: 1 });
          await sleep(600);
          const dropped = (await evaluate(asides)).find((a) => a.text === cut.text);
          assert.ok(whole(dropped) && !dropped.marked && dropped.opacity > 0.9, `${label}: put back, "${cut.text}" is whole and shown (${JSON.stringify(dropped)})`);
          await drag(-by);
          const back = await evaluate(asides);
          holds(`${label}, taken back`, back);
          assert.ok(!whole(back.find((a) => a.text === cut.text)), `${label}: dragged back out, "${cut.text}" is past the edge again`);
        }
      }
    } finally { await browser.close(); core.close(); }

    // ── Edge chips: a thought of someone else's lands far off in each direction. ──
    {
      const far = await standInCore(() => [{ type: "snapshot", world: farWorld.world }]);
      const view = await openPage("about:blank", { width, height });
      try {
        await view.page("Page.enable");
        await view.page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1");` });
        for (const scheme of ["light", "dark"]) {
          const label = `${width} ${scheme} chips`;
          await view.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: shots ? 2 : 1, mobile: phone });
          await view.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
          await view.page("Page.navigate", { url: `http://127.0.0.1:${far.port}/?shell=2` });
          assert.ok(await view.until(`!!document.querySelector(".spine-ready")`, 10000), `${label}: the canvas opens`);
          await view.evaluate(`document.fonts.ready.then(() => true)`);
          await sleep(500);
          let n = 0;
          for (const k of ["R", "D", "U", "L"]) {
            const id = `n${++n}`, text = `New words on ${farWorld.titles[k]}`;
            far.send({ type: "change", change: { type: "thought_added", thought: { ...thought(id, text, text, null, 0, { speaker: "Designer" }), placed: false, at_ms: Date.now() } } });
            far.send({ type: "change", change: { type: "thought_placed", thought_id: id, thread_id: `T${k}`, point: text, unclear: "", complete: true, place_ms: 1500 } });
            await sleep(320);
          }
          await sleep(600); // chips come in over 0.3 s
          const list = await view.evaluate(chips);
          assert.ok(list.length >= (phone ? 2 : 4), `${label}: a chip for the arrivals (${JSON.stringify(list.map((c) => c.text))})`);
          for (const c of list) {
            assert.ok(c.box.left >= 0 && c.box.top >= 0 && c.box.right <= c.width && c.box.bottom <= c.height, `${label}: "${c.text}" is whole in the screen (${JSON.stringify(c.box)})`);
          }
          if (!phone) assert.deepEqual([...new Set(list.map((c) => c.edge))].sort(), ["bottom", "left", "right", "top"], `${label}: a chip on each edge (${JSON.stringify(list.map((c) => [c.edge, c.text]))})`);
          else assert.ok(list.every((c) => c.edge === "row"), `${label}: a phone's chips are one row`);
          if (shots) {
            const shot = await view.page("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(shots, `chips-four-edges-${width}-${scheme}.png`), Buffer.from(shot.data, "base64"));
          }
        }
      } finally { await view.close(); far.close(); }
    }
  }
} catch (error) {
  console.error(`edge-whole-check failed: ${error.stack ?? error.message}`);
  process.exit(1);
}
console.log("edge-whole-check: an aside is whole or hidden, never sliced by the edge (1440 and 390, light and dark), and comes whole when the canvas is dragged to it; edge chips sit whole on each of the four edges");
