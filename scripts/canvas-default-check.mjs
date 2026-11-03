// Which page opens: the shell with no flag (and for ?shell=2, its old address, even beside ?cards); the classic page
// for ?shell=1, starting on the Canvas, and for ?cards, on cards. Synthetic map, throwaway browser storage, and the real
// built UI. SHOTS=dir saves the classic page's Canvas (?shell=1) at laptop/phone device sizes, light and dark.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP canvas-default-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`canvas-default-check: ${error.message}`); process.exit(1); });

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const empty = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const full = { ...empty,
  threads: [thread("T1", "Garden plans"), thread("T2", "Weekend picnic"), thread("T3", "Train tickets")],
  thoughts: [thought("p0", "Prepare the garden beds first", "T1"), thought("p1", "Plant tomatoes by the fence", "T1"), thought("p2", "Bring the folding chairs", "T2"), thought("p3", "Book the morning train", "T3")],
  active: "T1", active_by: { you: "T1" },
  // A jump must move the camera: its destination starts well outside the first viewport.
  positions: { p0: { x: -2200, y: -1800, by: "you", at_ms: now }, p2: { x: 2200, y: 1800, by: "you", at_ms: now }, p3: { x: 4400, y: 3600, by: "you", at_ms: now } },
};
let shown = full;
const move = (id) => {
  shown = { ...shown, active: id, active_by: { you: id } };
  core.send({ type: "change", change: { type: "active_changed", thread_id: id, speaker: "you" } });
};
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => { if (message.type === "focus") move(message.thread_id); },
});
const base = `http://127.0.0.1:${core.port}/`;
const shots = process.env.SHOTS;
let browser = null;

// Check geometry and hit testing, so a thread in the DOM but off the camera or behind the dock cannot pass.
function visiblePoint(id, canvas) {
  const el = document.querySelector(canvas ? `.react-flow__node[data-id="p:${id}"] .spine-text` : `#point-${id}`);
  if (!el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  const frame = canvas ? document.querySelector(".spine-frame").getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  const dock = document.querySelector(".dock")?.getBoundingClientRect();
  const tools = document.querySelector(".map-tools")?.getBoundingClientRect();
  const bottom = Math.min(innerHeight, frame.bottom, dock?.top ?? innerHeight);
  const top = Math.max(0, frame.top, tools?.bottom ?? 0);
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.width > 0 && r.height > 0 && r.left >= Math.max(0, frame.left) - 1 && r.right <= Math.min(innerWidth, frame.right) + 1
    && r.top >= top - 1 && r.bottom <= bottom + 1 && !!hit && el.contains(hit);
}

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const scheme of ["light", "dark"]) {
      const label = `${width}x${height} ${scheme}`;
      shown = full;
      // openPage owns a new throwaway Chrome profile. Install error capture before loading any app code.
      browser = await openPage("about:blank", { width, height });
      const { page, evaluate, until } = browser;
      // Without Page.enable, Chrome accepts the script below and never runs it.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.clear(); sessionStorage.clear();
        window.__canvasCheck = { errors: [], fresh: localStorage.length === 0 && sessionStorage.length === 0 };
        // Chrome reports a size observer whose change lands a frame later (the dock's, on first paint) as a window error: not one.
        addEventListener("error", e => { if (!/^ResizeObserver loop/.test(e.message)) __canvasCheck.errors.push(e.message || "Resource failed: " + e.target?.src); }, true);
        addEventListener("unhandledrejection", e => __canvasCheck.errors.push(String(e.reason)));
        const error = console.error;
        console.error = (...args) => { __canvasCheck.errors.push(args.map(String).join(" ")); error.apply(console, args); };
      ` });
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      const healthy = async () => {
        assert.deepEqual(await evaluate("__canvasCheck.errors"), [], `${label}: browser errors`);
        assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI`);
        assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: sideways overflow`);
      };
      const navigate = async (query, selector) => {
        await healthy();
        await page("Page.navigate", { url: base + query });
        assert.ok(await until(`document.readyState === "complete" && !!document.querySelector(${JSON.stringify(selector)})`, 10000), `${label}: ${query || "/"} loads ${selector}`);
        await evaluate("document.querySelector('.tour-skip')?.click()");
        await evaluate("document.fonts.ready.then(() => true)");
        await sleep(400);
        assert.ok(await evaluate("__canvasCheck.fresh"), `${label}: starts with fresh storage`);
        await healthy();
      };
      const view = async (name) => {
        await evaluate(`[...document.querySelectorAll('.palace-switch button')].find(b => b.textContent === ${JSON.stringify(name)}).click()`);
        assert.ok(await until(`[...document.querySelectorAll('.palace-switch button')].some(b => b.textContent === ${JSON.stringify(name)} && b.getAttribute('aria-pressed') === 'true')`), `${label}: opens ${name}`);
      };
      const returnTo = async (id) => {
        const selector = `.palace-tile[data-thread="${id}"]`;
        assert.ok(await until(`!!document.querySelector(${JSON.stringify(selector)})`), `${label}: Palace offers ${id}`);
        const at = await evaluate(`(() => {
          const tile = document.querySelector(${JSON.stringify(selector)});
          tile.scrollIntoView({ block: "center", behavior: "instant" });
          const r = tile.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          return { x, y, onTop: tile.contains(document.elementFromPoint(x, y)) };
        })()`);
        assert.ok(at.onTop, `${label}: Palace return can be clicked`);
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
      };
      const canvasPoint = async (id) => {
        assert.ok(await until(`!!document.querySelector('.spine-frame.spine-ready') && (${visiblePoint.toString()})(${JSON.stringify(id)}, true)`, 8000), `${label}: Canvas visibly reaches ${id}`);
        assert.equal(await evaluate("!!document.querySelector('main.map')"), false, `${label}: retains Canvas`);
        await healthy();
      };
      // In cards the point can already be in view before the answer arrives: the answer has landed once its "look here"
      // mark (data-look) is on the point.
      const cardsPoint = (id) => until(`!!document.getElementById(${JSON.stringify(`point-${id}`)})?.hasAttribute("data-look") && (${visiblePoint.toString()})(${JSON.stringify(id)}, false)`, 8000);
      const find = (id, point) => {
        // The core's Find response focuses first, then sends its private found message (core/src/find.rs).
        move(id);
        core.send({ type: "found", thread_id: id, thought_id: point, message: "Found the requested point" });
      };

      // The classic page (?shell=1), no other flags, no previously enabled bricks: it starts on the Canvas.
      await page("Page.navigate", { url: base + "?shell=1" });
      assert.ok(await until("!!document.querySelector('.spine-frame.spine-ready')", 10000), `${label}: ?shell=1 opens Canvas`);
      assert.equal(await evaluate("document.documentElement.classList.contains('shell2') || !!document.querySelector('.app.shell, [data-slot=stage]')"), false, `${label}: ?shell=1 is the classic page`);
      await evaluate("document.querySelector('.tour-skip')?.click()");
      await evaluate("document.fonts.ready.then(() => true)");
      assert.ok(await evaluate("__canvasCheck.fresh"), `${label}: ?shell=1 has fresh storage`);
      assert.deepEqual(await evaluate("({ width: innerWidth, height: innerHeight })"), { width, height }, `${label}: actual device viewport`);
      await canvasPoint("p1");
      if (shots) {
        mkdirSync(shots, { recursive: true });
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const png = Buffer.from(data, "base64");
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], `${label}: screenshot dimensions`);
        writeFileSync(join(shots, `canvas-default-${width}x${height}-${scheme}.png`), png);
      }

      assert.equal(await evaluate(`(${visiblePoint.toString()})("p0", true)`), false, `${label}: older active-thread point begins off camera`);
      find("T1", "p0");
      await canvasPoint("p0");
      // Wait past follow's spacing: it must not replace an older Find result with the active thread's tip.
      await sleep(2700);
      await canvasPoint("p0");
      assert.equal(await evaluate(`(${visiblePoint.toString()})("p3", true)`), false, `${label}: Find destination begins off camera`);
      find("T3", "p3");
      await canvasPoint("p3");

      // A real pan stops follow; explicit Find still aims at another thread, then an older point on that thread.
      const pan = await evaluate(`(() => { const r = document.querySelector('.spine-frame').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 40 }; })()`);
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...pan });
      await page("Input.dispatchMouseEvent", { type: "mousePressed", ...pan, button: "left", buttons: 1, clickCount: 1 });
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: pan.x + 80, y: pan.y + 60, button: "left", buttons: 1 });
      await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: pan.x + 80, y: pan.y + 60, button: "left", clickCount: 1 });
      assert.ok(await until(`!!document.querySelector('.spine-follow[aria-pressed="false"]')`), `${label}: manual pan stops follow`);
      assert.equal(await evaluate(`(${visiblePoint.toString()})("p1", true)`), false, `${label}: held-camera Find destination begins off camera`);
      find("T1", "p1");
      await canvasPoint("p1");
      assert.ok(await evaluate(`!!document.querySelector('.spine-follow[aria-pressed="false"]')`), `${label}: Find respects held follow`);
      find("T1", "p0");
      await canvasPoint("p0");
      // Returning to a previously found result is a fresh request, including while follow remains held.
      find("T1", "p1");
      await canvasPoint("p1");
      // A Palace tile uses the existing open-thread/goBack action and its focus request.
      await view("Pictures");
      const before = core.heard.length;
      await returnTo("T2");
      await canvasPoint("p2");
      assert.ok(core.heard.slice(before).some((m) => m.type === "focus" && m.thread_id === "T2"), `${label}: return focuses requested thread`);
      // Find also returns from another view to Canvas.
      await view("Pictures");
      find("T1", "p1");
      await canvasPoint("p1");
      // A landing is followed by the Canvas without cards' held-landing notice.
      const landing = thought("landed", "Pack a picnic blanket", "T1");
      shown = { ...shown, thoughts: [...shown.thoughts, landing] };
      core.send({ type: "change", change: { type: "thought_added", thought: landing } });
      await canvasPoint("landed");
      assert.equal(await evaluate("!!document.querySelector('.attention-note')"), false, `${label}: no cards landing notice`);

      // Explicit cards navigation stays on cards, including Find and return from Palace.
      shown = full;
      await navigate("?cards", "main.map .thread");
      assert.equal(await evaluate("!!document.querySelector('.spine-frame')"), false, `${label}: ?cards shows cards`);
      find("T3", "p3");
      assert.ok(await cardsPoint("p3"), `${label}: cards Find visibly reaches p3`);
      await view("Pictures");
      await returnTo("T2");
      assert.ok(await until(`(${visiblePoint.toString()})("p2", false)`, 8000), `${label}: cards return visibly reaches p2`);
      assert.equal(await evaluate("!!document.querySelector('.spine-frame')"), false, `${label}: cards return retains cards`);

      // The same with ?shell=1&cards: the cards flag still asks for cards beside the classic flag.
      shown = full;
      await navigate("?shell=1&cards", "main.map .thread");
      assert.equal(await evaluate("!!document.querySelector('.spine-frame')"), false, `${label}: ?shell=1&cards shows cards`);

      // Choosing Map explicitly on the classic page keeps cards for a subsequent Find (the functional updater).
      shown = full;
      await navigate("?shell=1", ".spine-frame.spine-ready");
      await view("Cards");
      find("T2", "p2");
      assert.ok(await cardsPoint("p2"), `${label}: chosen Map retains cards on Find`);
      assert.equal(await evaluate("!!document.querySelector('.spine-frame')"), false, `${label}: chosen Map stays on cards after Find`);
      await healthy();

      // Empty maps still show the classic page's first-run welcome; the next snapshot opens its Canvas.
      shown = empty;
      await navigate("?shell=1", ".empty h1");
      assert.equal(await evaluate("document.querySelector('.empty h1').textContent"), "Think out loud.");
      shown = full;
      core.send({ type: "snapshot", world: shown });
      await canvasPoint("p1");

      // No flag is the shell, and ?shell=2, its old address, is the same page, even alongside the cards flag.
      for (const query of ["", "?shell=2", "?shell=2&cards"]) {
        shown = full;
        await navigate(query, ".app.shell .spine-frame.spine-ready");
        assert.equal(await evaluate("document.documentElement.classList.contains('shell2')"), true, `${label}: ${query || "/"} is the shell`);
        assert.ok(await evaluate("!!document.querySelector('[data-slot=stage]')"), `${label}: ${query || "/"}: shell stage`);
        assert.equal(await evaluate("!!document.querySelector('.palace-switch')"), false, `${label}: ${query || "/"}: shell layout`);
      }
      // The shell's first open on an empty map, with no flag and with the old address.
      shown = empty;
      for (const query of ["", "?shell=2"]) await navigate(query, ".shell-welcome");
      await browser.close();
      browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
console.log("canvas-default-check: ok");
