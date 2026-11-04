// Built default Canvas, real keyboard/wheel input, synthetic public map. No model calls.
// Run after the UI build: node scripts/semantic-zoom-check.mjs. SHOTS=dir saves review PNGs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP semantic-zoom-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const now = Date.now() - 60_000;
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, thread_id) => ({ id, thread_id, speaker: "you", text: `Plan the next step for ${id}`, point: `Plan the next step for ${id}`, placed: true,
  unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const base = { active: "T0", active_by: { you: "T0" }, suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {} };
const small = { ...base, threads: [thread("T0", "Garden plans"), thread("T1", "A longer topic title that still needs to be readable"), thread("T2", "Call home"), thread("T3", "Pottery class", "T0"), thread("T4", "Book the seats", "T0")],
  thoughts: [thought("p0", "T0"), thought("p1", "T0"), thought("p2", "T1"), thought("p3", "T1"), thought("p4", "T2"), thought("p5", "T3"), thought("p6", "T4")] };
const large = { ...base, threads: Array.from({ length: 20 }, (_, i) => thread(`T${i}`, `Topic ${i + 1}`)),
  thoughts: Array.from({ length: 180 }, (_, i) => thought(`p${i}`, `T${Math.floor(i / 9)}`)) };
let world = small;
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
const metrics = [];
try {
  for (const [width, height, reduced] of [[1440, 900, false], [390, 844, false], [1440, 900, true]]) {
    world = small;
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    const key = async (key) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key });
    };
    const shot = async (name) => {
      if (!shots) return;
      const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(shots, `semantic-${name}-${width}${reduced ? "-reduced" : ""}.png`), Buffer.from(data, "base64"));
    };
    const feature = () => evaluate(`document.querySelector('[data-row="semantic-zoom"] [role="switch"]').click()`);
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured', '1');
      window.__errors = [];
      addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message); });
      addEventListener('unhandledrejection', e => __errors.push(String(e.reason)));
    ` });
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page("Emulation.setTouchEmulationEnabled", { enabled: width < 600, maxTouchPoints: 5 });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
      { name: "prefers-color-scheme", value: width < 600 ? "dark" : "light" }] });
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until(`!!document.querySelector('.spine-ready')`), "default Canvas opens");
    await key("c");
    assert.ok(await until(`!!document.querySelector('[data-row="semantic-zoom"] [role="switch"]')`), "Features contains Semantic zoom");
    assert.equal(await evaluate(`document.querySelector('[data-row="semantic-zoom"] [role="switch"]').getAttribute('aria-checked')`), "false", "off on a fresh visit");
    assert.equal(await evaluate(`!!document.querySelector('.spine-semantic')`), false);
    await feature();
    await key("Escape");
    assert.ok(await until(`document.querySelectorAll('.spine-semantic-summary').length === 5`), "every topic has an overview, including aside and tangent");
    await evaluate(`document.activeElement?.blur()`);
    await key("1");
    await sleep(450);
    const original = await evaluate(`[...document.querySelectorAll('.react-flow__node')].map(e => [e.dataset.id, e.style.transform])`);
    await evaluate(`window.__blend = []; window.__sample = true;
      function sample() {
        const root = document.querySelector('.spine-flow'), summary = document.querySelector('.spine-semantic-summary[data-thread="T0"]');
        __blend.push({ k: Number(getComputedStyle(root).getPropertyValue('--spine-k')), detail: Number(getComputedStyle(summary.previousElementSibling).opacity), overview: Number(getComputedStyle(summary).opacity), width: summary.getBoundingClientRect().width,
          tuckVisible: document.querySelector('.spine-tuck[data-thread="T3"]')?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
          tangentOverview: Number(getComputedStyle(document.querySelector('.spine-semantic-summary[data-thread="T3"]')).opacity) });
        if (__sample) requestAnimationFrame(sample);
      } requestAnimationFrame(sample);`);
    // Real animated zoom, through the threshold in both directions.
    for (let i = 0; i < 4; i++) { await key("-"); await sleep(230); }
    await shot("overview");
    const overview = await evaluate(`[...document.querySelectorAll('.spine-semantic-summary')].map(e => ({
      id: e.dataset.thread, count: e.querySelector('.spine-semantic-count').textContent,
      visible: e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
      font: parseFloat(getComputedStyle(e.querySelector('.spine-semantic-title')).fontSize),
      scale: e.getBoundingClientRect().width / e.offsetWidth
    }))`);
    assert.deepEqual(overview.map(e => [e.id, e.count]).sort(), [["T0", "2 thoughts"], ["T1", "2 thoughts"], ["T2", "1 thought"], ["T3", "1 thought"], ["T4", "1 thought"]]);
    for (const label of overview) {
      assert.ok(label.visible, `${label.id}: title visible below 11 px`);
      assert.ok(Math.abs(label.font * label.scale - 15) < 0.1, `${label.id}: title stays 15 screen px`);
    }
    assert.equal(await evaluate(`[...document.querySelectorAll('.spine-semantic-detail')].some(e => e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))`), false, "thoughts collapse completely");
    assert.equal(await evaluate(`[...document.querySelectorAll('.spine-bars')].some(e => e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))`), false, "no unreadable bars remain");
    assert.equal(await evaluate(`document.querySelector('.spine-semantic-summary[data-thread="T1"] .spine-semantic-title').textContent`), small.threads[1].title, "full long title retained");
    // At the fully collapsed endpoint, Tab cannot enter the invisible detailed controls.
    await evaluate(`document.querySelector('.spine-semantic-summary[data-thread="T0"]').focus()`);
    await key("Tab");
    assert.equal(await evaluate(`!!document.activeElement.closest('.spine-semantic-detail')`), false);
    await evaluate(`document.activeElement.blur()`);
    for (let i = 0; i < 4; i++) { await key("+"); await sleep(230); }
    await evaluate(`__sample = false`);
    const blend = await evaluate(`__blend`);
    if (width < 600) {
      const smallTextHidden = blend.filter(s => 1 / s.k > 0.75 && 1 / s.k < 11 / 13);
      assert.ok(smallTextHidden.length, "sampled the small-text cutoff before ordinary thoughts collapse");
      assert.ok(smallTextHidden.every(s => s.tuckVisible === false && s.tangentOverview > 0.999), "phone tangents collapse as soon as their own 13 px words fall below 11 screen px");
    }
    assert.ok(blend.some(s => s.detail > 0.1 && s.detail < 0.9), "intermediate states are rendered");
    for (const sample of blend) {
      const z = 1 / sample.k, t = Math.max(0, Math.min(1, (15 * z - 11) / 2));
      assert.ok(Math.abs(sample.detail - t * t * (3 - 2 * t)) < 0.002, "blend follows zoom continuously, without a timer or state swap");
      assert.ok(Math.abs(sample.detail + sample.overview - 1) < 0.002, "complementary crossfade");
    }
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.react-flow__node')].map(e => [e.dataset.id, e.style.transform])`), original, "zoom never changes node positions");
    await shot("reading");
    // Switch off while zoomed out, then restore; choice survives an actual page reload.
    await key("-"); await key("-"); await sleep(250);
    await key("c"); await feature(); await key("Escape");
    assert.ok(await until(`!document.querySelector('.spine-semantic-summary')`), "switch off restores existing Canvas");
    await key("c"); await feature(); await key("Escape");
    await page("Page.reload");
    assert.ok(await until(`!!document.querySelector('.spine-semantic .spine-semantic-summary')`), "setting persists after reload");
    // A normal pointer/touch activation returns from overview to reading size.
    await key("1"); await sleep(450);
    for (let i = 0; i < 4; i++) { await key("-"); await sleep(230); }
    await shot("activate");
    const target = await evaluate(`(() => { const r = document.querySelector('.spine-semantic-summary[data-thread="T0"]').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; })()`);
    if (width < 600) {
      await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [target] });
      await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...target, button: "left", clickCount: 1 });
    assert.ok(await until(`Number(document.querySelector('.react-flow__viewport').style.transform.split('scale(')[1].split(')')[0]) > 0.99`), `activate title to read (${width}, reduced=${reduced})`);

    if (width === 1440 && !reduced) {
      world = large;
      core.send({ type: "snapshot", world });
      assert.ok(await until(`document.querySelectorAll('.react-flow__node').length === 200`), "200 nodes mounted");
      await sleep(500);
      await evaluate(`window.__frames = []; window.__running = true; let previous = performance.now();
        function measure(now) { __frames.push(now - previous); previous = now; if (__running) requestAnimationFrame(measure); }
        requestAnimationFrame(measure);`);
      for (let i = 0; i < 60; i++) {
        await page("Input.dispatchMouseEvent", { type: "mouseWheel", x: 650, y: 350, deltaX: i < 30 ? 4 : -4, deltaY: i < 30 ? 4 : -4, modifiers: i % 20 < 10 ? 2 : 0 });
        await sleep(16);
      }
      const frames = await evaluate(`(__running = false, __frames.slice(1).sort((a,b) => a-b))`);
      const p95 = frames[Math.floor(frames.length * 0.95)];
      metrics.push(`200 nodes: ${frames.length} frames, p95 ${p95.toFixed(1)} ms`);
      assert.ok(frames.length >= 40 && p95 < 50, `pan/pinch stays responsive: p95 ${p95.toFixed(1)} ms`);
      assert.equal(await evaluate(`document.querySelectorAll('.react-flow__node').length`), 200);
      await shot("200-nodes");
    }
    assert.deepEqual(await evaluate(`__errors`), [], "no browser errors");
    assert.equal(await evaluate(`!!document.querySelector('.brick-broke, .crash')`), false);
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), "no page overflow");
    await browser.close(); browser = null;
  }
} finally {
  await browser?.close();
  core.close();
}
console.log(`semantic-zoom-check: ok (desktop, touch phone/dark, reduced motion; ${metrics.join('; ')})`);
