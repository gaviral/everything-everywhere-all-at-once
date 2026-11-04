// Real default Canvas and shipped public sample: readable, collision-free summaries while zooming.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';
const why = ready();
if (why) { console.log(`SKIP semantic-zoom-overlap-check: ${why}`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], topics: {} };
for (const line of readFileSync(new URL('../samples/student-week.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean)) {
  const event = JSON.parse(line);
  if (event.type === 'thread_added') world.threads.push(event.thread);
  else if (event.type === 'thought_added') world.thoughts.push(event.thought);
  else if (event.type === 'thread_status') world.threads.find(t => t.id === event.thread_id).status = event.status;
  else if (event.type === 'active_changed') { world.active = event.thread_id; world.active_by = { you: event.thread_id }; }
  else if (event.type === 'topics_assigned') for (const a of event.assigned) world.topics[a.thread_id] = a.topic;
}
function scan() {
  const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return { zoom: Number(getComputedStyle(document.querySelector('.spine-flow')).getPropertyValue('--spine-z')),
    labels: [...document.querySelectorAll('.spine-semantic-summary')].map(e => ({
      title: e.querySelector('.spine-semantic-title').textContent, count: e.querySelector('.spine-semantic-count').textContent,
      shift: parseFloat(e.style.getPropertyValue('--semantic-shift')) || 0,
      font: parseFloat(getComputedStyle(e.querySelector('.spine-semantic-title')).fontSize) * e.getBoundingClientRect().width / e.offsetWidth,
      ...rect(e) })) };
}
function clear(geometry, context) {
  assert.equal(geometry.labels.length, 8, `${context}: every topic present`);
  for (const [i, a] of geometry.labels.entries()) {
    assert.ok(Math.abs(a.font - 15) < .2, `${context}: readable ${a.title}`);
    for (const b of geometry.labels.slice(i + 1)) {
      assert.ok(a.x + a.w <= b.x + .5 || b.x + b.w <= a.x + .5 || a.y + a.h <= b.y + .5 || b.y + b.h <= a.y + .5,
        `${context}: ${a.title} overlaps ${b.title}`);
    }
  }
}
const core = await standInCore(() => [{ type: 'snapshot', world }]);
let browser;
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    browser = await openPage('about:blank', { width, height });
    const { page, evaluate, until } = browser;
    const key = async key => { for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key }); };
    await page('Page.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('e2a2o.toured', '1'); window.__errors = [];
      addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message); });
      addEventListener('unhandledrejection', e => __errors.push(String(e.reason)));` });
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until(`!!document.querySelector('.spine-ready')`));
    await key('c');
    assert.ok(await until(`!!document.querySelector('[data-row="semantic-zoom"] [role="switch"]')`));
    await evaluate(`document.querySelector('[data-row="semantic-zoom"] [role="switch"]').click()`);
    await key('Escape');
    await evaluate(`document.activeElement?.blur()`);
    await key('1'); await sleep(450);
    const positions = () => evaluate(`[...document.querySelectorAll('.react-flow__node')].map(e => [e.dataset.id, e.style.transform])`);
    const original = await positions();
    await evaluate(`window.scan = ${scan.toString()}`);
    let first;
    for (const zoom of (width >= 600 ? [.5, .6, .5] : [.5, .4, .25, .5])) {
      const current = (await evaluate('scan()')).zoom;
      // React Flow's real ctrl-wheel input: 50 delta units halve the zoom.
      await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: 50 * Math.log2(current / zoom), modifiers: 2 });
      await sleep(350);
      const geometry = await evaluate('scan()');
      assert.ok(Math.abs(geometry.zoom - zoom) < .001, `${width}: reaches ${zoom} (actual ${geometry.zoom})`);
      clear(geometry, `${width} at ${zoom}`);
      assert.deepEqual(await positions(), original, 'summary spacing never moves canvas nodes');
      if (zoom === .5) {
        if (!first) first = geometry;
        else for (let i = 0; i < first.labels.length; i++) assert.ok(Math.abs(first.labels[i].shift - geometry.labels[i].shift) < .1, 'reversing zoom restores the same summary placement');
        assert.equal(geometry.labels.find(e => e.title === 'Demo recording plan').count, '5 thoughts');
      }
    }
    if (process.env.SHOTS) {
      mkdirSync(process.env.SHOTS, { recursive: true });
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.SHOTS, `student-semantic-50-${width}.png`), Buffer.from(data, 'base64'));
    }
    await evaluate(`window.__frames = []; window.__sampling = true;
      function sample() { __frames.push(scan()); if (__sampling) requestAnimationFrame(sample); } requestAnimationFrame(sample);`);
    for (const input of (width >= 600 ? ['+', '+', '-', '-'] : ['-', '-', '-', '-', '+', '+', '+', '+'])) { await key(input); await sleep(230); }
    const frames = await evaluate('(__sampling = false, __frames)');
    assert.ok(frames.length > 30, 'samples actual animated zoom in both directions');
    for (const [index, frame] of frames.entries()) {
      clear(frame, `${width}, animation frame ${index}`);
      if (!index) continue;
      const previous = frames[index - 1];
      for (let i = 0; i < frame.labels.length; i++) {
        const label = frame.labels[i], prior = previous.labels[i];
        assert.ok(Math.abs(label.h - prior.h) < .2, 'fixed screen wrapping does not jump');
        assert.ok(Math.abs(label.shift - prior.shift) <= 5000 * Math.abs(frame.zoom - previous.zoom) + .5, `${label.title}: displacement changes continuously with zoom`);
      }
    }
    assert.deepEqual(await evaluate('__errors'), [], 'no browser errors');
    await browser.close(); browser = null;
  }
} finally { await browser?.close(); core.close(); }
console.log('semantic-zoom-overlap-check: ok (student sample, desktop/phone, 50/40/25%, animated zoom and reversal)');
