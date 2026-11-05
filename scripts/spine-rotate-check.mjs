// Mounted Canvas, synthetic World, fresh Chrome profiles. GestureEvent-shaped injections check the Safari handler;
// they do not establish physical trackpad support. SHOTS optionally keeps desktop and 390px screenshots.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';
import { screenToWorld, worldToScreen, turnAt } from '../ui/src/bricks/spine/rotation.ts';

const near = (a, b, message, tolerance = 2) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= tolerance,
  `${message}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
for (const angle of [-170, -45, 0, 27, 90, 179]) {
  const view = { x: 35, y: -42, zoom: .73, angle }, point = { x: -140, y: 236 };
  near(screenToWorld(worldToScreen(point, view), view), point, 'inverse round trip', 1e-8);
  const centroid = { x: 240, y: 380 };
  near(worldToScreen(screenToWorld(centroid, view), turnAt(view, angle + 33, centroid)), centroid, 'anchored turn', 1e-8);
}
const why = ready();
if (why) { console.log(`SKIP i-rotate-check: ${why} (pure geometry passed)`); process.exit(3); }
const at = Date.now() - 120000;
const initial = {
  threads: [{ id: 'T1', title: 'Garden plan', parent_id: null, status: 'open', last_point: 'Choose a sunny spot', touched_ms: at,
    tags: [], picture: null, dropped_by: '' }],
  thoughts: ['Plant mint in a pot', 'Choose a sunny spot'].map((text, i) => ({ id: `p${i + 1}`, speaker: 'you', text, point: text,
    thread_id: 'T1', placed: true, unclear: '', guess: '', heard: '', fixed: '', complete: true, at_ms: at + i, decided: false })),
  positions: { p2: { x: 50, y: 140, by: 'you', at_ms: at } },
  active: 'T1', active_by: { you: 'T1' }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], topics: {},
};
let world = structuredClone(initial), browser;
const core = await standInCore(() => [{ type: 'snapshot', world }], { onMessage: message => {
  if (message.type !== 'position') return;
  assert.equal(message.id, 'p2', 'only the explicitly dragged thought moves');
  world.positions[message.id] = { x: message.x, y: message.y, by: 'you', at_ms: at + 10 };
  core.send({ type: 'positioned', id: message.id, ...world.positions[message.id] });
} });
try {
  for (const width of [1440, 390]) {
    world = structuredClone(initial); core.heard.length = 0;
    browser = await openPage('about:blank', { width, height: 900 });
    const { page, evaluate, until } = browser;
    const key = async (key, code = key) => { for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: ({ Tab: 9, Enter: 13, Escape: 27 })[key] ?? 0,
      ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) }); };
    const navigate = async () => {
      await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?shell=2` });
      assert.ok(await until(`!!document.querySelector('.spine-ready') && !!document.querySelector('[data-id="p:p2"]')`), 'Canvas mounts');
      await sleep(100);
    };
    await page('Page.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('e2a2o.toured', '1'); window.__errors = [];
      addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message); });
      addEventListener('unhandledrejection', e => __errors.push(String(e.reason)));
    ` });
    if (width === 390) await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await navigate();
    assert.equal(await evaluate(`!!document.querySelector('.spine-rotation')`), false, 'fresh profile defaults off');
    const toggle = async expected => {
      await evaluate('document.activeElement?.blur()'); await key('c', 'KeyC');
      assert.ok(await until(`!!document.querySelector('[data-row="rotate-canvas"] [role="switch"]')`));
      assert.equal(await evaluate(`document.querySelector('[data-row="rotate-canvas"] [role="switch"]').getAttribute('aria-checked')`), String(!expected));
      await evaluate(`document.querySelector('[data-row="rotate-canvas"] [role="switch"]').click()`);
      await key('Escape');
      assert.ok(await until(`!!document.querySelector('.spine-rotation') === ${expected}`), 'Features switches the mounted UI');
    };
    await toggle(true);
    const setAngle = async value => {
      await evaluate(`(() => { const e = document.querySelector('[aria-label="Canvas angle in degrees"]'); e.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '${value}');
        e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      assert.ok(await until(`Number(document.querySelector('.spine-frame').dataset.rotationAngle) === ${value}`), `Angle reaches ${value}`);
      await sleep(60);
    };
    // Actual rendered marker, rather than an expected position derived only from our transform functions.
    const probe = () => evaluate(`(() => {
      const root = document.querySelector('[data-id="p:p2"] .spine-rotated-item');
      let probe = root.querySelector('.rotation-probe');
      if (!probe) { probe = document.createElement('span'); probe.className = 'rotation-probe';
        probe.style.cssText = 'position:absolute;left:80px;top:10px;width:0;height:0;pointer-events:none'; root.append(probe); }
      const r = probe.getBoundingClientRect(); return { x: r.x, y: r.y };
    })()`);
    const view = () => evaluate(`(() => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
      const r = document.querySelector('.spine-flow').getBoundingClientRect();
      return { x: m.e + r.left, y: m.f + r.top, zoom: m.a, angle: Number(document.querySelector('.spine-frame').dataset.rotationAngle) };
    })()`);
    const center = (controls = true) => evaluate(`(() => {
      const r = document.querySelector('.spine-flow').getBoundingClientRect();
      const top = Math.max(r.top, ...[...document.querySelectorAll('[data-slot="top-left"], [data-slot="top-right"], .talk-pill${controls ? ', .spine-rotation' : ''}')]
        .map(e => e.getBoundingClientRect()).filter(b => b.width && b.height).map(b => b.bottom + 8));
      const stage = document.querySelector('[data-slot="stage"]').getBoundingClientRect();
      const dock = parseFloat(getComputedStyle(document.querySelector('.spine-anchor')).getPropertyValue('--dock-height')) || 0;
      // Floating shell controls reserve a bottom band even when the stage is empty.
      const controls = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-content-bottom')) || 0;
      const bottom = Math.min(r.bottom - controls, stage.height ? Math.min(r.bottom, stage.top - 8) : r.bottom - dock);
      return { x: (r.left + r.right) / 2, y: (top + Math.max(top + 120, bottom)) / 2 };
    })()`);
    const gesture = async (type, point, rotation, scale = 1) => evaluate(`(() => {
      const e = new Event('${type}', { bubbles: true, cancelable: true });
      Object.assign(e, { clientX: ${point.x}, clientY: ${point.y}, rotation: ${rotation}, scale: ${scale} });
      document.querySelector('.spine-flow').dispatchEvent(e); return e.defaultPrevented;
    })()`);
    await setAngle(25);
    assert.equal(core.heard.filter(m => m.type === 'position').length, 0, 'turning changes no World position');
    const anchored = await probe();
    assert.equal(await gesture('gesturestart', anchored, 0), true);
    assert.equal(await gesture('gesturechange', anchored, 20, 1.1), true);
    await sleep(100);
    near(await probe(), anchored, `${width}: gesture centroid stays within 2px`);
    assert.ok(Math.abs((await view()).angle - 45) < .01);
    await gesture('gestureend', anchored, 20, 1.1);

    // Browser wheel pan and Ctrl-wheel pinch zoom stay in screen axes at the rotated angle.
    const panBefore = await probe();
    await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: 350, deltaX: 24, deltaY: 16 });
    await sleep(150);
    const panAfter = await probe();
    assert.ok(Math.hypot(panAfter.x - panBefore.x, panAfter.y - panBefore.y) > 5, 'pan moves the rendered thought');
    assert.equal((await view()).angle, 45, 'pan keeps angle');
    const zoomAnchor = await probe(), zoomBefore = (await view()).zoom;
    await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zoomAnchor.x, y: zoomAnchor.y, deltaX: 0, deltaY: -8, modifiers: 2 });
    await sleep(150);
    near(await probe(), zoomAnchor, 'pinch zoom keeps its screen anchor');
    assert.ok((await view()).zoom > zoomBefore, 'Ctrl-wheel is zoom, not rotation');
    assert.equal((await view()).angle, 45);

    // Hit the rotated text and drag it to a known unrotated World coordinate through native mouse input.
    const start = await probe();
    assert.equal(await evaluate(`document.elementFromPoint(${start.x}, ${start.y})?.closest('.react-flow__node')?.dataset.id`), 'p:p2', 'rotated hit testing');
    const target = { x: initial.positions.p2.x + 32, y: initial.positions.p2.y + 21 };
    await evaluate('document.activeElement?.blur()');
    await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    // React Flow establishes its grab offset only after its existing 4px drag threshold. Measure the live grip
    // after crossing that threshold, then move the rendered marker to the independently chosen World target.
    const activePointer = { x: Math.round(start.x + 8), y: Math.round(start.y) };
    await page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...activePointer, button: 'left', buttons: 1 });
    await sleep(60);
    const activeProbe = await probe();
    const expected = worldToScreen({ x: target.x + 80, y: target.y + 10 }, await view());
    const end = { x: activePointer.x + expected.x - activeProbe.x, y: activePointer.y + expected.y - activeProbe.y };
    for (let step = 1; step <= 6; step++) {
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: activePointer.x + (end.x - activePointer.x) * step / 6, y: activePointer.y + (end.y - activePointer.y) * step / 6, button: 'left', buttons: 1 });
      await sleep(30);
    }
    await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await sleep(400);
    near(world.positions.p2, target, 'drag sends the inverse-mapped World coordinate', 1);
    near(await probe(), expected, 'dragged thought reaches the projected World target');
    assert.deepEqual(world.thoughts, initial.thoughts, 'source thought records unchanged');
    assert.deepEqual(world.threads, initial.threads, 'topic records unchanged');
    assert.deepEqual(Object.keys(world.positions), ['p2'], 'no incidental positions');
    assert.deepEqual(core.heard.filter(m => m.type === 'email'), [{ type: 'email', on: true }], 'one default email handshake');
    assert.deepEqual(core.heard.filter(m => !(m.type === 'email' && m.on === true) && !['position', 'heartbeat', 'attention'].includes(m.type) && !(['partner', 'voice_shortcuts', 'reply_format', 'agreement_switch', 'connections_switch'].includes(m.type) && m.on === false)), [],
      'no record writes beyond the explicit position (ordinary hover and disabled per-window feature handshakes allowed)');

    if (process.env.SHOTS) {
      mkdirSync(process.env.SHOTS, { recursive: true });
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.SHOTS, `i-rotate-${width}.png`), Buffer.from(data, 'base64'));
    }
    const resetCenter = await center(), centeredWorld = screenToWorld(resetCenter, await view());
    await evaluate(`document.querySelector('[aria-label="Canvas angle in degrees"]').focus()`);
    await key('Tab');
    assert.equal(await evaluate('document.activeElement.textContent'), 'Reset angle', 'Tab reaches Reset');
    await key('Enter'); await sleep(100);
    assert.equal((await view()).angle, 0, 'keyboard Reset returns angle to zero');
    near(worldToScreen(centeredWorld, await view()), resetCenter, 'reset preserves the centered world point');
    assert.equal(await evaluate('document.activeElement.textContent'), 'Reset angle', 'reset keeps keyboard focus');

    await setAngle(-20);
    await page('Page.reload');
    assert.ok(await until(`!!document.querySelector('.spine-ready') && !!document.querySelector('.spine-rotation')`));
    assert.equal((await view()).angle, 0, 'Features preference survives reload; camera angle does not');
    await setAngle(30);
    await toggle(false); await sleep(100);
    assert.equal((await view()).angle, 0);
    const ordinaryOrigin = await evaluate(`(() => { const r = document.querySelector('[data-id="p:p2"]').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    near(ordinaryOrigin, worldToScreen(world.positions.p2, await view()), 'off uses ordinary zero-angle World-to-screen math');
    const offView = await view();
    assert.equal(await gesture('gesturestart', { x: 180, y: 350 }, 0), false, 'off removes gesture handlers');
    await gesture('gesturechange', { x: 180, y: 350 }, 40);
    assert.deepEqual(await view(), offView, 'off ignores synthetic rotation input');
    assert.equal(await evaluate(`!!document.querySelector('.spine-rotated-item')`), false, 'ordinary node renderer restored');
    await page('Page.reload');
    assert.ok(await until(`!!document.querySelector('.spine-ready')`));
    assert.equal(await evaluate(`!!document.querySelector('.spine-rotation')`), false, 'disabled stays disabled on reload');
    assert.deepEqual(await evaluate('__errors'), [], 'no browser errors');
    await browser.close(); browser = null;
  }
} finally { await browser?.close(); core.close(); }
console.log('i-rotate-check: ok (pure inverse; mounted Features/default/off/reload; 2px gesture anchor; pan/zoom; World drag; keyboard reset; desktop/390px reduced motion). Physical trackpad unverified.');
