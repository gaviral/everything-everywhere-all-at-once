// The AI helper's pointing arrow crosses no button and no line of text. The demo QA found it sweeping from the caption
// at the foot of the screen up to Catalog, across Finish it and Later and the canvas's words; the arrow is now a short
// one at the part, from the nearest side with room, and the part's ring alone when it is boxed in.
// Held here, on the built UI in headless Chrome over a stand-in core, at a laptop (1440 × 900) and a phone (390 × 844),
// alone and in a call (the Talk pill under Catalog), the unfinished card up over the stage, as the QA walked it:
//  - for each part pointed at (Catalog, Find, a thread, a point, the unfinished card), the arrow as drawn is measured
//    against the page itself, not the arrow's own rules: no point of its line or head is over a control (a hit test
//    and the control's box) or over a line of text (each text node's own rectangles);
//  - it is short, at the part (its tip clear of the part's ring), on screen, and the same on a second look;
//  - where the corner has room, there is an arrow (Catalog at both sizes; in a call at a phone's width, where Find and the
//    Talk pill box Catalog in, the ring alone), and it follows the part when the canvas moves.
// SHOTS=<folder> also saves a screenshot of each scene there (light and dark).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP arrow-clear-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`arrow-clear-check: ${error.stack ?? error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const now = Date.now();
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const world = {
  threads: [thread("T1", "Hackathon plan"), thread("T2", "Rent is due", { status: "dropped", dropped_by: "you", touched_ms: now - 60000 }),
    thread("T3", "Group project meeting"), thread("T4", "Mom's birthday")],
  thoughts: [
    thought("a1", "Deadline tomorrow 9 PM, need to record demo", "T1"), thought("a2", "Repo ready, precheck passes, README not done", "T1"),
    thought("a3", "Write README before recording", "T1"), thought("a4", "Priority: README, record, submit; rent now; text Priya", "T1"),
    thought("b1", "Rent due on the 1st", "T2"), thought("b2", "It's already the 3rd so it's technically late, I need to do it right now before they charge a fee", "T2"),
    thought("c1", "Group presentation Wednesday, Priya's slides missing", "T3"), thought("c2", "Text Priya tonight, check Marcus's data section", "T3"),
    thought("d1", "Mom's birthday is Saturday", "T4"),
  ],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["AI helper"],
  positions: { a1: { x: 0, y: 0, by: "you", at_ms: now }, b1: { x: 600, y: 0, by: "you", at_ms: now }, c1: { x: 0, y: 700, by: "you", at_ms: now }, d1: { x: 600, y: 700, by: "you", at_ms: now } },
};
const person = (name, ai) => ({ name, ai, joined_ms: now - 60000, here: true, left_ms: null, mic: false, speaking: false, read: null });
const call = { type: "call", started_ms: now - 50000, people: [person("you", false), person("AI helper", true)], level: "speak", level_by: "" };

// What each part gets: "arrow", "ring" (the ring alone: boxed in), or null (either; only the crossing is held).
const expected = {
  "1440 alone": { catalog: "arrow", search: "arrow", "thread:T2": "arrow", "point:b2": "arrow", unfinished: null },
  "1440 call": { catalog: "arrow", search: "arrow", "thread:T2": "arrow", "point:b2": "arrow", unfinished: null },
  "390 alone": { catalog: "arrow", search: "arrow", "point:b2": null, unfinished: null },
  "390 call": { catalog: "ring", search: "arrow", "point:b2": null, unfinished: null },
};

/** Measured in the page, against the page: every point of the arrow's line and head, and what's under it. */
const measure = `(() => {
  const layer = document.querySelector(".guide-layer");
  const line = document.querySelector(".guide-arrow-line"), head = document.querySelector(".guide-arrow-head");
  const out = { state: layer?.dataset.state ?? null, arrow: false, crossings: [], d: null };
  if (!layer || !line || !head || getComputedStyle(line.ownerSVGElement).display === "none") return out;
  const visible = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const words = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.nodeValue.trim() || !el || el.closest(".guide-layer, .sr-only, script, style") || !visible(el)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) words.push({ r, what: n.nodeValue.trim().slice(0, 30) });
  }
  const controls = [...document.querySelectorAll('button, a[href], input, textarea, select, summary, [role="button"], [role="tab"]')]
    .filter((el) => !el.closest(".guide-layer, .sr-only") && visible(el)).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 1 && r.height > 1);
  const inside = (r, p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  const points = [];
  const length = line.getTotalLength();
  for (let at = 0; at <= length; at += 2) { const p = line.getPointAtLength(at); points.push({ x: p.x, y: p.y, what: "line" }); }
  const end = line.getPointAtLength(length), start = line.getPointAtLength(0);
  // The head: its three corners, as drawn (a triangle with its tip at the origin, turned and moved by its transform).
  const t = head.getAttribute("transform").match(/translate\\(([-\\d.]+) ([-\\d.]+)\\) rotate\\(([-\\d.]+)\\)/);
  const [ox, oy, turn] = [+t[1], +t[2], (+t[3] * Math.PI) / 180];
  const corners = [...head.getAttribute("d").matchAll(/(-?[\\d.]+) (-?[\\d.]+)/g)].map((m) => [+m[1], +m[2]])
    .map(([x, y]) => ({ x: ox + x * Math.cos(turn) - y * Math.sin(turn), y: oy + x * Math.sin(turn) + y * Math.cos(turn), what: "head" }));
  points.push(...corners);
  // And the head's inside: the middle of each side and its centre.
  for (let i = 0; i < corners.length; i++) { const a = corners[i], b = corners[(i + 1) % corners.length]; points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, what: "head" }); }
  points.push({ x: corners.reduce((n, c) => n + c.x, 0) / corners.length, y: corners.reduce((n, c) => n + c.y, 0) / corners.length, what: "head" });
  for (const p of points) {
    const under = document.elementFromPoint(p.x, p.y)?.closest('button, a[href], input, textarea, select, summary, [role="button"], [role="tab"]');
    if (under) out.crossings.push({ kind: "control (hit test)", at: p, what: (under.getAttribute("aria-label") || under.textContent || under.tagName).trim().slice(0, 30) });
    for (const c of controls) if (inside(c.r, p)) out.crossings.push({ kind: "control", at: p, what: (c.el.getAttribute("aria-label") || c.el.textContent).trim().slice(0, 30) });
    for (const w of words) if (inside(w.r, p)) out.crossings.push({ kind: "text", at: p, what: w.what });
  }
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  return { ...out, arrow: true, d: line.getAttribute("d"), side: head.dataset.side, tip: { x: ox, y: oy }, tail: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
    onScreen: points.every((p) => p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight), count: points.length,
    ring: (() => { const r = document.querySelector(".guide-ring")?.getBoundingClientRect(); return r && box(r); })() };
})()`;

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const inCall of [false, true]) {
    const scene = `${width} ${inCall ? "call" : "alone"}`;
    const core = await standInCore(() => [...(inCall ? [call] : []), { type: "snapshot", world }]);
    const guide = (target, text = "Here it is.") => core.send({ type: "guide", kind: "point", target, text, by: "AI helper", at_ms: Date.now() });
    const browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    try {
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1");` });
      for (const scheme of shots ? ["light", "dark"] : ["light"]) {
        await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: shots ? 2 : 1, mobile: width < 600 });
        await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
        await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
        assert.ok(await until(`!!document.querySelector(".spine-ready")`, 10000), `${scene}: the canvas opens`);
        // The QA's scene: the unfinished card rises over the stage after a pause; a call has the Talk pill under Catalog.
        assert.ok(await until(`!!document.querySelector('[data-guide="unfinished"]')`, 8000), `${scene}: the unfinished card is up`);
        // This scene inspects the card after several other targets. Hold it by its normal
        // focus rule so driver scheduling cannot spend its reading time before that look.
        await evaluate(`document.querySelector('[data-guide="unfinished"] button:not(:disabled)').focus({ preventScroll: true })`);
        assert.ok(await until(`!!document.activeElement?.closest('[data-guide="unfinished"]')`), `${scene}: the unfinished card is held by focus`);
        if (inCall) assert.ok(await until(`!!document.querySelector(".talk-pill")`, 3000), `${scene}: the Talk pill is up`);
        await evaluate(`document.fonts.ready.then(() => true)`);
        await sleep(400);

        // The view may still be moving (it brings a point into view); the arrow is measured once it has stood still.
        const settle = async () => {
          let last = null, same = 0;
          for (let i = 0; i < 50 && same < 3; i++) {
            await sleep(120);
            const now = await evaluate(`(document.querySelector(".guide-layer")?.dataset.state ?? "") + (document.querySelector(".guide-arrow-line")?.getAttribute("d") ?? "")`);
            same = now === last ? same + 1 : 0;
            last = now;
          }
          return same >= 3;
        };
        const look = async (target) => {
          guide(target, `Here is ${target}.`);
          assert.ok(await until(`["aimed", "near"].includes(document.querySelector(".guide-layer")?.dataset.state) && !!document.querySelector(".guide-caption")`, 4000), `${scene}: ${target}: a point lands`);
          assert.ok(await settle(), `${scene}: ${target}: the arrow settles`);
          const first = await evaluate(measure);
          await sleep(260);
          const second = await evaluate(measure);
          assert.equal(second.d, first.d, `${scene}: ${target}: the arrow is the same on a second look`);
          assert.ok(await evaluate(`document.activeElement?.matches('[data-guide="unfinished"] button:not(:disabled)')`), `${scene}: ${target}: focus still holds the unfinished card`);
          return first;
        };

        for (const [target, want] of Object.entries(expected[scene])) {
          const seen = await look(target);
          const label = `${scene}, ${scheme}: ${target}`;
          assert.deepEqual(seen.crossings.slice(0, 3), [], `${label}: the arrow crosses ${seen.crossings.length} control(s) or line(s) of text`);
          if (want === "arrow") assert.equal(seen.arrow, true, `${label}: an arrow (the state is ${seen.state})`);
          if (want === "ring") assert.deepEqual([seen.arrow, seen.state], [false, "near"], `${label}: the ring alone, boxed in`);
          if (seen.arrow) {
            const run = Math.hypot(seen.tail.x - seen.end.x, seen.tail.y - seen.end.y);
            assert.ok(run >= 30 && run <= 80, `${label}: a short arrow at the part (${run.toFixed(0)} px)`);
            assert.ok(seen.onScreen, `${label}: on screen`);
            assert.ok(seen.ring, `${label}: its ring`);
            // Its tip is clear of the ring and close to it: the part's facing edge is TIP_GAP (14 px) from the tip.
            const { ring, tip, side } = seen;
            const gap = side === "below" ? tip.y - ring.bottom : side === "above" ? ring.top - tip.y : side === "left" ? ring.left - tip.x : tip.x - ring.right;
            assert.ok(gap >= 2 && gap <= 12, `${label}: the tip is just clear of the ring (${gap.toFixed(1)} px)`);
          }
          if (shots && ["catalog", "point:b2"].includes(target)) {
            const shot = await page("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(shots, `arrow-${target.replace(/\W/g, "-")}-${width}-${scheme}${inCall ? "-call" : ""}.png`), Buffer.from(shot.data, "base64"));
          }
          guide(null, "");
          assert.ok(await until(`!document.querySelector(".guide-layer")`, 2000), `${label}: the point comes down`);
        }

        // It follows the part when the canvas moves (a drag on the empty canvas), and still crosses nothing there.
        if (scheme === "light" && width >= 600) {
          const target = "point:b2";
          const before = await look(target);
          const from = await evaluate(`(() => { for (let y = 120; y < innerHeight - 200; y += 16) for (let x = innerWidth - 60; x > 200; x -= 16)
            if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y }; return null; })()`);
          assert.ok(from, `${scene}: an empty place on the canvas to drag from`);
          await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
          for (let i = 0; i <= 8; i++) {
            await page("Input.dispatchMouseEvent", { type: i === 0 ? "mousePressed" : "mouseMoved", x: from.x - i * 8, y: from.y + i * 6, button: "left", buttons: 1, clickCount: 1 });
            await sleep(20);
          }
          await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x - 64, y: from.y + 48, button: "left", buttons: 0, clickCount: 1 });
          assert.ok(await settle(), `${scene}: the arrow settles after the canvas moved`);
          const after = await evaluate(measure);
          assert.ok(after.arrow, `${scene}: still an arrow after the canvas moved`);
          const moved = { x: after.tip.x - before.tip.x, y: after.tip.y - before.tip.y };
          assert.ok((Math.abs(moved.x + 64) <= 3 && Math.abs(moved.y - 48) <= 3) || after.side !== before.side,
            `${scene}: the arrow moved with its part (${JSON.stringify(before.tip)} → ${JSON.stringify(after.tip)})`);
          assert.deepEqual(after.crossings.slice(0, 3), [], `${scene}: after the canvas moved, the arrow still crosses nothing`);
          guide(null, "");
        }
      }
    } finally { await browser.close(); core.close(); }
  }
} catch (error) {
  console.error(`arrow-clear-check failed: ${error.stack ?? error.message}`);
  process.exit(1);
}
console.log("arrow-clear-check: at 1440 and 390, alone and in a call, the arrow at Catalog, Find, a thread, a point and the unfinished card crosses no button or line of text, is short and at the part, and follows it; boxed in, the ring alone");
