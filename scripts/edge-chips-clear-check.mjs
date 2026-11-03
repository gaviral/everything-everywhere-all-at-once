// Edge chips (something new landed out of view) stay clear of the controls and read as words. The demo QA found that
// after one click a chip landed under Find and Catalog, where the top-right controls took every press, and that on a
// phone the chips shrank to "G", "E" and a dot.
// Held here, on the built UI in headless Chrome over a stand-in core, as the QA walked it: others' thoughts land on
// threads far off in every direction (seven arrivals), a chip is clicked with a real mouse press, more land:
//  - at a laptop's size (1440 × 900), alone, in a call (the Talk pill under Catalog) and in a short window (1440 × 540,
//    where the edge's slots reach the Talk pill): every chip is whole on screen, its middle and four inner points are
//    its own (a hit test: nothing floats over it), it covers no button or field, none overlaps another, it has its
//    title or its "+N";
//  - at a phone's widths (320 to 430): the same, and every title is readable (at least 64 px of it, or all of it), never
//    a lone letter; the row gives one chip fewer, and counts it in "+N", before it squeezes one.
// SHOTS=<folder> also saves a screenshot of each scene there (light and dark).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP edge-chips-clear-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`edge-chips-clear-check: ${error.stack ?? error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, speaker = "you") => ({ id, speaker, text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const titles = { T2: "Rent is due", T3: "Group project meeting", T4: "Mom's birthday", T5: "Electric bill autopay", T6: "Stats midterm", T7: "Flights to Lisbon", T8: "Insurance renewal" };
// Each thread's first point is placed far off in its own direction: right, below, below right, above, left, and two up and to the right.
const far = { b: [1500, 0, "T2"], c: [0, 1500, "T3"], d: [1500, 1500, "T4"], e: [800, -1400, "T5"], f: [-1500, 0, "T6"], g: [2600, -1800, "T7"], h: [1800, -2400, "T8"] };
const world = {
  threads: [thread("T1", "Hackathon plan"), ...Object.entries(titles).map(([id, title]) => thread(id, title))],
  thoughts: [thought("a1", "Deadline tomorrow 9 PM, need to record demo", "T1"), thought("a2", "Repo ready, precheck passes, README not done", "T1"),
    ...Object.entries(far).map(([k, [, , t]]) => thought(`${k}1`, `First thought on ${titles[t]}`, t))],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["AI helper"],
  positions: { a1: { x: 0, y: 0, by: "you", at_ms: now }, ...Object.fromEntries(Object.entries(far).map(([k, [x, y]]) => [`${k}1`, { x, y, by: "you", at_ms: now }])) },
};
const person = (name, ai) => ({ name, ai, joined_ms: now - 60000, here: true, left_ms: null, mic: false, speaking: false, read: null });
const callMsg = { type: "call", started_ms: now - 50000, people: [person("you", false), person("AI helper", true)], level: "speak", level_by: "" };

/** Every chip as drawn, and every control it must not cover (the canvas's own points are what chips float over); measured in the page. */
const measure = `(() => {
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const shown = (e) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const chips = [...document.querySelectorAll(".spine-cue")].map((b) => {
    const r = b.getBoundingClientRect(), title = b.querySelector(".spine-cue-title"), count = b.querySelector(".spine-cue-count");
    const points = [[0.5, 0.5], [0.12, 0.25], [0.88, 0.25], [0.12, 0.75], [0.88, 0.75]].map(([fx, fy]) => ({ x: r.left + r.width * fx, y: r.top + r.height * fy }));
    const covered = points.map((p) => ({ p, hit: document.elementFromPoint(p.x, p.y) })).filter(({ hit }) => !hit || !b.contains(hit))
      .map(({ p, hit }) => ({ x: Math.round(p.x), y: Math.round(p.y), by: hit ? (hit.getAttribute("aria-label") || hit.closest("[data-slot]")?.dataset.slot || hit.className || hit.tagName) : "nothing" }));
    return { name: b.getAttribute("aria-label"), box: box(r), text: b.textContent.trim(), covered,
      title: title && { text: title.textContent, whole: title.scrollWidth <= title.clientWidth, width: title.clientWidth },
      count: count && { text: count.textContent, whole: count.scrollWidth <= count.clientWidth } };
  });
  const controls = [...document.querySelectorAll('button, input, textarea, select, a[href], [role="button"]')]
    .filter((e) => !e.closest(".spine-cues, .spine-cue-line, .guide-layer, .sr-only, .react-flow") && shown(e))
    .map((e) => ({ what: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 24), box: box(e.getBoundingClientRect()) }))
    .filter((c) => c.box.right > c.box.left && c.box.bottom > c.box.top);
  return { width: innerWidth, height: innerHeight, chips, controls, overflow: document.documentElement.scrollWidth > innerWidth, pill: !!document.querySelector(".talk-pill") };
})()`;

const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const MIN_LABEL = 64;

/** What holds at any moment: whole on screen, nothing over a chip, no chip over a control or another chip, words. */
function holds(label, g, { phone }) {
  assert.ok(g.chips.length >= 1, `${label}: chips`);
  assert.ok(!g.overflow, `${label}: no sideways overflow`);
  for (const c of g.chips) {
    const where = `${label}: "${c.text}"`;
    assert.ok(c.box.left >= 0 && c.box.top >= 0 && c.box.right <= g.width && c.box.bottom <= g.height, `${where} is whole on screen (${JSON.stringify(c.box)})`);
    assert.deepEqual(c.covered, [], `${where} can be pressed: nothing is over it`);
    for (const k of g.controls) assert.ok(!overlap(c.box, k.box), `${where} covers the control "${k.what}"`);
    for (const o of g.chips) if (o !== c) assert.ok(!overlap(c.box, o.box), `${where} overlaps "${o.text}"`);
    if (c.title) {
      assert.match(c.title.text.trim(), /\S{2}/, `${where}: a title, not a lone letter`);
      if (phone) assert.ok(c.title.whole || c.title.width >= MIN_LABEL, `${where}: its title is readable (${c.title.width} px of "${c.title.text}")`);
    } else {
      assert.match(c.count?.text ?? "", /^\+\d+$/, `${where}: a count, "+N"`);
      assert.ok(c.count.whole, `${where}: its count whole`);
    }
  }
}

const scenes = [
  { name: "1440 alone", width: 1440, height: 900 },
  { name: "1440 call", width: 1440, height: 900, call: true },
  { name: "1440 short call", width: 1440, height: 540, call: true },
  { name: "390 alone", width: 390, height: 844, phone: true },
];
try {
  for (const scene of scenes) {
    const { width, height, phone = false } = scene;
    const core = await standInCore(() => [...(scene.call ? [callMsg] : []), { type: "snapshot", world }]);
    const browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    let n = 0;
    const arrive = async (key) => {
      const [, , t] = far[key];
      const id = `n${++n}`, text = `New words on ${titles[t]} ${n}`;
      core.send({ type: "change", change: { type: "thought_added", thought: { ...thought(id, text, null, "Maya"), placed: false, at_ms: Date.now() } } });
      core.send({ type: "change", change: { type: "thought_placed", thought_id: id, thread_id: t, point: text, unclear: "", complete: true, place_ms: 1500 } });
      await sleep(320);
    };
    try {
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1");` });
      for (const scheme of shots ? ["light", "dark"] : ["light"]) {
        await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: shots ? 2 : 1, mobile: phone });
        await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
        await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
        assert.ok(await until(`!!document.querySelector(".spine-ready")`, 10000), `${scene.name}: the canvas opens`);
        if (scene.call) assert.ok(await until(`!!document.querySelector(".talk-pill")`, 3000), `${scene.name}: the Talk pill is up`);
        await evaluate(`document.fonts.ready.then(() => true)`);
        await sleep(500);
        const label = `${scene.name}, ${scheme}`;
        const look = async (when) => {
          await sleep(400); // chips come in over 0.3 s
          const g = await evaluate(measure);
          holds(`${label}, ${when}`, g, { phone });
          return g;
        };
        const snap = async (name) => {
          if (!shots) return;
          const shot = await page("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(shots, `chips-${name}-${width}${height < 600 ? "x" + height : ""}-${scheme}${scene.call ? "-call" : ""}.png`), Buffer.from(shot.data, "base64"));
        };

        for (const key of ["b", "e", "d", "c", "f", "g", "h"]) await arrive(key);
        const first = await look("seven arrivals");
        assert.ok(first.chips.length >= (phone || height < 600 ? 2 : 4), `${label}: chips for the arrivals (${first.chips.length})`);
        if (!phone && width >= 1000) assert.ok(first.chips.some((c) => c.box.top < 120 || c.box.right > width - 300), `${label}: chips reach the corner's side of the screen`);
        await snap("arrivals");

        // The QA's step: one click (a real press at the chip's middle) takes the view there, and more land.
        const target = first.chips.find((c) => c.title) ?? first.chips[0];
        const [cx, cy] = [(target.box.left + target.box.right) / 2, (target.box.top + target.box.bottom) / 2];
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x: cx, y: cy, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
        assert.ok(await until(`!${JSON.stringify(target.name)} || ![...document.querySelectorAll(".spine-cue")].some((b) => b.getAttribute("aria-label") === ${JSON.stringify(target.name)})`, 4000), `${label}: the pressed chip goes`);
        await sleep(1000); // the view moves there
        await look("after the click");
        for (const key of ["g", "h", "e"]) await arrive(key);
        await look("more arrivals after the click");
        await snap("after-click");

        // A phone's other widths: the row gives one chip fewer before it squeezes a title to a letter.
        if (phone && scheme === "light") for (const w of [320, 360, 414, 430]) {
          await page("Emulation.setDeviceMetricsOverride", { width: w, height, deviceScaleFactor: 1, mobile: true });
          await sleep(450);
          const g = await look(`at ${w} px`);
          assert.equal(g.width, w, `the page is ${w} px wide`);
        }
      }
    } finally { await browser.close(); core.close(); }
  }
} catch (error) {
  console.error(`edge-chips-clear-check failed: ${error.stack ?? error.message}`);
  process.exit(1);
}
console.log("edge-chips-clear-check: at a laptop's size (alone, in a call, in a short window) every edge chip is whole, pressable, clear of every button and of the others, and says its title or its count, before and after a click; on a phone (320 to 430 px) every title is readable, never a lone letter");
