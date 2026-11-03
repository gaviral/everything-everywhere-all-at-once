// A phone's canvas (the new shell's Spine at 390 × 844, touch, no hover) draws a topic's title, its meta line and a
// point's tools at the sizes the layout measured; the laptop's too. The morning walk (2026-11-03) found `(hover: none)`
// giving every button 40 px (styles.css): a title 40 px tall slid down over its own meta line, and the tool that keeps a
// point on the shelf, 40 px wide, covered the end of the words it sat beside. Only the canvas's own controls keep their
// size; the real buttons (Shelf, a card's Finish it, Catalog) stay 40 px targets.
// Real browser input against the built UI and a synthetic map, which Finish it's card is offered on (a topic left
// unfinished); a real touch tap shows a point's tools. SHOTS=dir saves each state at laptop and phone sizes, light and
// dark.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP phone-canvas-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`phone-canvas-check: ${error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const now = Date.now() - 3 * 60_000;
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true,
  at_ms: now, place_ms: 2000, decided: false, ...extra });
// A topic left unfinished (its last words trail off: the card offers Finish it), the one you are on, with a point of words
// long enough to run to the end of its line, one with a long title that takes two lines, and a topic of one short point,
// which the canvas draws as a pill (an aside), not a head.
const world = {
  threads: [thread("T1", "Balcony herbs", { status: "dropped", dropped_by: "you" }), thread("T2", "Rent"), thread("T3", "Electric bill and the late fee, before it comes due"), thread("T4", "Call home")],
  thoughts: [
    thought("p1", "Plant mint in its own pot by the door", "T1"),
    thought("p2", "I should choose the picnic spot before—", "T1", { complete: false }),
    thought("p3", "Rent due Friday, not sent yet, and the transfer limit resets on the first so I could wait", "T2"),
    thought("p4", "Autopay is not set up", "T3"),
    thought("p5", "Check the date the fee starts", "T3"),
    thought("p6", "Ask about Sunday", "T4"),
  ],
  active: "T2", active_by: { you: "T2" }, suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
};
let shown = world;
const core = await standInCore(() => [{ type: "snapshot", world: shown }]);

/** The most a canvas tool may measure: its design (spine.css) is a 24 px circle, 12 px above the words' top and 8 px past
 *  their right edge, so at most 12 px of a line's height and 16 px of its end are under it. */
const TOOL_MAX = 24.5, UNDER_ACROSS = 16.5, UNDER_DOWN = 12.5;
/** What a real button is on touch: the page's own floor (styles.css). */
const TARGET_MIN = 40;

let browser = null;
let runs = 0;
try {
  for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]]) {
    for (const scheme of ["light", "dark"]) {
      const label = `${width}x${height} ${scheme}${touch ? " touch" : ""}`;
      shown = world;
      browser = await openPage("about:blank", { width, height });
      const { page, evaluate, until } = browser;
      // As in cards-esc-check: Page.enable is required for the storage script to run.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.clear(); sessionStorage.clear();
        localStorage.setItem("e2a2o.toured", "1");
        window.__errors = [];
        addEventListener("error", e => {
          if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src);
        }, true);
        addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
        const error = console.error;
        console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };
      ` });
      // A touch phone as phone-check has it: coarse pointer, no hover, a phone's viewport.
      await page("Emulation.setTouchEmulationEnabled", touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
      assert.ok(await until('!!document.querySelector(".spine-frame.spine-ready") && document.querySelectorAll(".spine-head").length === 3 && !!document.querySelector(".spine-aside")', 10000), `${label}: the canvas opens with its three topics and a pill`);
      await evaluate("document.fonts.ready.then(() => true)");
      assert.equal(await evaluate('matchMedia("(hover: none)").matches'), touch, `${label}: ${touch ? "no hover, as a phone" : "hover, as a laptop"}`);
      // Finish it's card comes after the pause the app waits for; the walk's phone shot had it under the canvas.
      assert.ok(await until('!!document.querySelector(".pullback")', 8000), `${label}: the unfinished topic is offered`);
      await sleep(300);
      const shot = async (name) => {
        if (!shots) return;
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shots, `phone-canvas-${name}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
      };

      // Each topic's title fills the room above its meta line: the box ends where the line starts, however many lines the
      // title takes, and never grows past what the layout gave it.
      const heads = await evaluate(`[...document.querySelectorAll(".spine-head")].map((head) => {
        const title = head.querySelector(".spine-title").getBoundingClientRect(), meta = head.querySelector(".spine-head-meta").getBoundingClientRect();
        const lines = Math.round(parseFloat(getComputedStyle(head.querySelector(".spine-title")).lineHeight) ? title.height / parseFloat(getComputedStyle(head.querySelector(".spine-title")).lineHeight) : 0);
        return { name: head.querySelector(".spine-title").textContent, title: { top: title.top, bottom: title.bottom, height: title.height }, meta: { top: meta.top }, lines };
      })`);
      assert.equal(heads.length, 3, `${label}: every topic is measured`);
      for (const head of heads) {
        assert.ok(head.title.bottom <= head.meta.top + 0.5, `${label}: "${head.name}" ends at ${head.title.bottom.toFixed(1)}, over its meta line that starts at ${head.meta.top.toFixed(1)}`);
        assert.ok(Math.abs(head.title.height - (head.meta.top - head.title.top)) <= 0.5, `${label}: "${head.name}" is ${head.title.height.toFixed(1)} px tall, not the ${(head.meta.top - head.title.top).toFixed(1)} px the layout gave it`);
      }
      assert.ok(heads.some((head) => head.lines >= 2), `${label}: one title takes two lines, so the check isn't only for a one-line title`);
      await shot("canvas");

      // A tap on a point's words shows its tools. They keep their own size, so the one that keeps it on the shelf sits at the
      // corner of the words and covers no more of them than its design does.
      const words = await evaluate(`(() => { const r = document.querySelector('.spine-point[data-thought="p3"] .spine-text').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 11 }; })()`);
      if (touch) {
        await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: words.x, y: words.y }] });
        await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...words });
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...words, button: "left", clickCount: 1 });
      }
      assert.ok(await until(`getComputedStyle(document.querySelector('.spine-point[data-thought="p3"] .spine-tools')).display !== "none"`, 3000), `${label}: a tap on a point's words shows its tools`);
      await sleep(200);
      const tools = await evaluate(`(() => {
        const point = document.querySelector('.spine-point[data-thought="p3"]');
        const plain = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        const box = (el) => plain(el.getBoundingClientRect());
        // The words as the lines they take: each line's own rectangle, not the box they sit in.
        const range = document.createRange();
        range.selectNodeContents(point.querySelector(".spine-words"));
        return { tools: [...point.querySelectorAll(".spine-tool")].map((tool) => ({ label: tool.getAttribute("aria-label"), ...box(tool) })),
          select: [...point.querySelectorAll(".spine-tool-select")].map((select) => box(select)), lines: [...range.getClientRects()].map(plain) };
      })()`);
      assert.ok(tools.tools.length >= 1, `${label}: the point has a tool`);
      for (const tool of tools.tools) {
        assert.ok(tool.width <= TOOL_MAX && tool.height <= TOOL_MAX, `${label}: "${tool.label}" is ${tool.width.toFixed(0)} × ${tool.height.toFixed(0)} px, not its own ${TOOL_MAX - 0.5} px`);
        for (const line of tools.lines) {
          const across = Math.min(tool.right, line.right) - Math.max(tool.left, line.left), down = Math.min(tool.bottom, line.bottom) - Math.max(tool.top, line.top);
          assert.ok(across <= 0 || down <= 0 || (across <= UNDER_ACROSS && down <= UNDER_DOWN), `${label}: "${tool.label}" covers ${across.toFixed(0)} × ${down.toFixed(0)} px of the point's words (its design: ${UNDER_ACROSS - 0.5} × ${UNDER_DOWN - 0.5} at most)`);
        }
      }
      for (const select of tools.select) assert.ok(select.width <= TOOL_MAX && select.height <= TOOL_MAX, `${label}: a theme picker takes ${select.width.toFixed(0)} × ${select.height.toFixed(0)} px of the point's side`);
      await shot("tools");

      // What is a real button stays a 40 px target on touch: the canvas's own corner (its Shelf, which stands inside the
      // canvas but outside its nodes), the card's Finish it and Later, the page's Catalog.
      if (touch) {
        const buttons = await evaluate(`[...document.querySelectorAll(".spine-frame .spine-corner button, .spine-shelf-head, .pullback-actions button, .shell-corner button.shell-pill")]
          .filter((el) => el.getClientRects().length).map((el) => { const r = el.getBoundingClientRect(); return { name: (el.textContent || el.getAttribute("aria-label") || el.className).trim().slice(0, 24), width: r.width, height: r.height }; })`);
        assert.ok(buttons.length >= 4, `${label}: Shelf, Finish it, Later and Catalog are measured (found ${buttons.map((b) => b.name).join(", ")})`);
        for (const button of buttons) assert.ok(button.width >= TARGET_MIN && button.height >= TARGET_MIN, `${label}: "${button.name}" is ${button.width.toFixed(0)} × ${button.height.toFixed(0)} px, under a ${TARGET_MIN} px target`);
      }

      assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors`);
      assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI`);
      assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: no horizontal overflow`);
      runs++;
      await browser.close();
      browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
console.log(`phone-canvas-check: ok (${runs} runs: each topic's title ends where its meta line starts, a point's tools keep their own size and cover no more of its words than their design, the real buttons stay 40 px on touch; laptop and phone, light and dark)`);
