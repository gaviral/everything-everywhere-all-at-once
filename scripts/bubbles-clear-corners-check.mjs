// Bubbles in the real shell, opened by Catalog's Show (no view query). Throwaway storage, synthetic core,
// real pointer input, normal motion. SHOTS=dir saves the open view before any interaction navigates away.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP bubbles-clear-corners-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`bubbles-clear-corners-check: ${error.message}`); process.exit(1); });
const now = Date.now();
const titles = ["Hackathon demo", "Group presentation", "Rent transfer", "Weekly groceries", "Weekend hike", "Call home"];
const themes = ["Study and projects", "Home and everyday plans", "Friends and weekends"];
const threads = titles.map((title, i) => ({
  id: `T${i + 1}`, title, parent_id: null, status: "open", last_point: "", touched_ms: now,
  tags: [], picture: null, dropped_by: "",
}));
const world = {
  threads,
  thoughts: threads.flatMap((t, i) => Array.from({ length: i % 3 + 2 }, (_, n) => ({
    id: `p${i}-${n}`, speaker: "you", text: `${t.title}: point ${n + 1}`, point: `Point ${n + 1}`,
    thread_id: t.id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true,
    at_ms: now, place_ms: 2000, decided: false,
  }))),
  topics: Object.fromEntries(threads.map((t, i) => [t.id, themes[Math.floor(i / 2)]])),
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], proposals: [],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
};
let shown = world;
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => {
    if (message.type !== "focus") return;
    shown = { ...shown, active: message.thread_id, active_by: { you: message.thread_id } };
    core.send({ type: "change", change: { type: "active_changed", thread_id: message.thread_id, speaker: "you" } });
  },
});
const shots = process.env.SHOTS;
let browser = null;
let runs = 0;
try {
  if (shots) mkdirSync(shots, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const scheme of ["light", "dark"]) {
      const label = `${width}x${height} ${scheme}`;
      shown = world;
      core.heard.length = 0;
      browser = await openPage("about:blank", { width, height });
      const { page, evaluate, until } = browser;
      // As in cards-esc-check: Page.enable is required for the storage script to run.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.clear(); sessionStorage.clear();
        localStorage.setItem("e2a2o.bricks", JSON.stringify({ bubbles: true }));
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
      const tap = async (selector, what) => {
        const where = () => evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return "not there";
          el.scrollIntoView({ block: "center", behavior: "instant" });
          if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return "not shown";
          const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return "outside the window";
          const hit = document.elementFromPoint(x, y);
          return hit && el.contains(hit) ? { x, y } : "covered by " + (hit?.closest("[class]")?.className ?? hit?.tagName);
        })()`);
        let at = await where();
        for (let waited = 0; typeof at !== "object" && waited < 4000; waited += 100) { await sleep(100); at = await where(); }
        assert.equal(typeof at, "object", `${label}: ${what} takes a pointer tap (${at})`);
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
        for (const type of ["mousePressed", "mouseReleased"]) {
          await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
        }
      };
      const healthy = async () => {
        assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors`);
        assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI`);
        assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: no horizontal overflow`);
      };

      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2&bubbles` });
      assert.ok(await until('document.readyState === "complete" && !!document.querySelector(".app.shell .spine-frame.spine-ready")', 10000), `${label}: populated shell opens on Canvas`);
      await tap('.shell-tr [data-guide="catalog"]', "Catalog");
      assert.ok(await until('!!document.querySelector(\'[data-slot="rail"] [data-row="bubbles"] .shell-link\')'), `${label}: enabled Bubbles has Catalog Show`);
      await tap('[data-row="bubbles"] .shell-link', "Bubbles Show");
      assert.ok(await until('document.documentElement.dataset.view === "bubbles" && !!document.querySelector(".bubbles-intro h1") && !document.querySelector(\'[data-slot="rail"]\')'), `${label}: Show opens Bubbles and closes Catalog`);
      await evaluate("document.fonts.ready.then(() => true)");
      // Wait for finite entrance animations, leaving the gentle infinite float running.
      await evaluate(`Promise.all(document.querySelector(".bubbles").getAnimations({ subtree: true })
        .filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)).then(() => true)`);
      await sleep(200);
      await evaluate("window.scrollTo(0, 0)");
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");

      const layout = await evaluate(`(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        const corners = [...document.querySelectorAll(".shell-corner")].filter(visible).map(rect)
          .filter(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight);
        const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const content = [...document.querySelectorAll(".bubbles-intro h1, .bubbles-intro p, .bubbles-eyebrow, .bubbles-topic")];
        const introRange = document.createRange();
        introRange.selectNodeContents(document.querySelector(".bubbles-intro p"));
        return {
          corners,
          content: content.map(el => ({ text: el.textContent, ...rect(el), visible: visible(el),
            position: getComputedStyle(el).position, clipped: el.scrollWidth > el.clientWidth + 1,
            intersects: corners.some(c => overlaps(rect(el), c)) })),
          chipRows: new Set([...document.querySelectorAll(".bubbles-topic")].map(el => Math.round(rect(el).top))).size,
          introLines: new Set([...introRange.getClientRects()].map(r => Math.round(r.top))).size,
        };
      })()`);
      assert.ok(layout.corners.length >= 2, `${label}: visible shell corners are measured`);
      assert.equal(layout.content.length, themes.length + 3, `${label}: heading, introduction and all themes present`);
      for (const el of layout.content) {
        assert.ok(el.visible && el.width > 0 && el.height > 0, `${label}: ${el.text} is visible`);
        assert.ok(el.left >= 0 && el.right <= width + 1 && el.top >= 0 && el.bottom <= height, `${label}: ${el.text} fits on screen`);
        assert.equal(el.intersects, false, `${label}: ${el.text} clears visible corner controls`);
        assert.equal(el.clipped, false, `${label}: ${el.text} is not clipped`);
        assert.ok(!["fixed", "absolute", "sticky"].includes(el.position), `${label}: introduction and themes stay in scroll flow`);
      }
      if (width === 390) {
        assert.ok(layout.chipRows > 1, `${label}: theme chips wrap`);
        assert.ok(layout.introLines > 1, `${label}: introduction wraps`);
      }
      await healthy();
      if (shots) {
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shots, `bubbles-open-${width}-${scheme}.png`), Buffer.from(data, "base64"));
      }

      await tap(".bubbles-topic", "first theme chip");
      assert.ok(await until('document.querySelector(".bubbles-topic")?.getAttribute("aria-pressed") === "true" && document.querySelectorAll(".bubbles-faded").length === 4'), `${label}: theme tap highlights its bubbles`);
      await tap(".bubbles-topic", "first theme chip again");
      await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: width - 1, y: 70 });
      assert.ok(await until('!document.querySelector(".bubbles-faded")'), `${label}: theme tap releases highlighting`);
      // The lowest bubble must scroll above the composer, even at the end of the document.
      const lowest = await evaluate(`[...document.querySelectorAll(".bubbles-face")].sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0].dataset.thread`);
      const target = `.bubbles-face[data-thread="${lowest}"]`;
      await evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({ block: "center", behavior: "instant" })`);
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(target)}).getBoundingClientRect().bottom < document.querySelector(".shell-composer").getBoundingClientRect().top`), `${label}: bottom bubble is reachable above composer`);
      await tap(target, "bubble");
      assert.ok(await until('document.documentElement.dataset.view === "map" && !document.querySelector(".bubbles") && !!document.querySelector(".spine-frame.spine-ready")'), `${label}: bubble returns to Canvas`);
      for (let waited = 0; waited < 2000 && !core.heard.some(m => m.type === "focus" && m.thread_id === lowest); waited += 50) await sleep(50);
      assert.ok(core.heard.some(m => m.type === "focus" && m.thread_id === lowest), `${label}: bubble opens its thread at the core`);
      assert.equal(shown.active, lowest, `${label}: chosen thread becomes active`);
      await healthy();
      runs++;
      await browser.close();
      browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
console.log(`bubbles-clear-corners-check: ok (${runs} runs: Catalog Show, corner clearance, wrapping, theme input and bubble thread return; laptop and phone, light and dark)`);
