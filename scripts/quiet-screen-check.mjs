// One browser acceptance check for quiet chrome. Synthetic map, no capture or model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ready, standInCore, openPage } from './headless.mjs';

const unavailable = ready();
if (unavailable) { console.log(`SKIP quiet-screen-check: ${unavailable}`); process.exit(3); }
assert.equal(JSON.parse(readFileSync(new URL('../ui/src/bricks/quiet-screen/brick.json', import.meta.url))).defaultOn, false);
const artifacts = mkdtempSync(join(tmpdir(), 'quiet-screen-check-'));
const at = Date.now() - 60000;
const empty = () => ({ threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], questions: [] });
const full = () => ({ ...empty(), active: 'garden', active_by: { you: 'garden' },
  threads: [['garden', 'A garden for everyone'], ['water', 'Keep the rain'], ['bench', 'A place to pause']].map(([id, title]) => ({ id, title, parent_id: null, status: 'open', last_point: '', touched_ms: at, tags: [], picture: null, dropped_by: '' })),
  thoughts: [['sun', 'garden', 'Plant herbs where the morning sun reaches.'], ['mint', 'garden', 'Keep mint in its own pot.'], ['rain', 'water', 'Catch rainwater for the dry weeks.'], ['seat', 'bench', 'Leave room for a bench under the tree.']].map(([id, thread_id, text]) => ({ id, thread_id, text, point: text, speaker: 'you', placed: true, complete: true, at_ms: at, place_ms: null, unclear: '' })) });
let world = empty();
const core = await standInCore(() => [{ type: 'snapshot', world }]);
let browser;
try {
  // Preserve the throwaway profile: no deletes and no access to a person's Chrome.
  browser = await openPage('about:blank', { width: 1920, height: 1080, preserveProfile: true });
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('e2a2o.toured','1');
    window.quietCaptureCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.quietCaptureCalls++; throw Error('Capture forbidden in this check'); };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => new URL(input instanceof Request ? input.url : String(input), location.href).pathname === '/flow/library'
      ? Promise.resolve(new Response(JSON.stringify({flows:[]}),{headers:{'Content-Type':'application/json'}})) : originalFetch(input,init);
    window.EventSource = class extends EventTarget { close() {} };
  ` });
  const wait = async (condition, label, ms = 7000) => assert.ok(await until(condition, ms), `TIMING: ${label}`);
  const opacity = selector => `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`;
  const rect = selector => `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`;
  const move = async () => {
    await evaluate('window.quietWakeAt = performance.now()');
    const x = await evaluate('Math.floor(innerWidth / 2)');
    await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 120 });
    assert.equal(await evaluate(opacity('[data-slot="top-right"]')), '1', 'pointer wakes controls immediately');
  };
  const idle = async () => {
    await wait(`document.documentElement.classList.contains('quiet-screen-idle') && ${opacity('[data-slot="top-right"]')} === '0'`, 'controls finish their idle fade');
    assert.ok(await evaluate('performance.now() - window.quietWakeAt >= 1950'), 'controls remain visible for two seconds');
  };
  const shot = async name => writeFileSync(join(artifacts, `${name}.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const settleCamera = async () => assert.ok(await evaluate(`new Promise(resolve => {
    let last = '', stableSince = performance.now(); const deadline = stableSince + 7000;
    const frame = () => {
      const canvas = document.querySelector('.spine-ready .react-flow__viewport');
      const transform = canvas ? getComputedStyle(canvas).transform : '';
      const now = performance.now();
      if (!transform || transform !== last) { last = transform; stableSince = now; }
      if (transform && now - stableSince >= 400) resolve(true);
      else if (now >= deadline) resolve(false);
      else requestAnimationFrame(frame);
    }; frame();
  })`), 'TIMING: initial camera reaches a stable visible position');
  const enter = async (state, query = '', width = 1920) => {
    world = state;
    await page('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 1080, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/${query}` });
    await wait(`document.documentElement.classList.contains('quiet-screen') && !!document.querySelector('.spine-frame textarea[aria-label="Type a thought"]')`, 'default shell and real input ready');
    if (state.thoughts.length) await wait(`!!document.querySelector('[data-thought="sun"]')`, 'full map thoughts rendered');
    await settleCamera();
    await move();
  };
  const checkGeometry = async before => assert.deepEqual(await evaluate(rect('[data-slot="top-right"]')), before, 'chrome keeps exactly the same layout when faded');
  const visibleInput = async () => assert.ok(await evaluate(`(() => { const e = document.querySelector('textarea[aria-label="Type a thought"]'); for(let p=e;p;p=p.parentElement) if(getComputedStyle(p).opacity === '0' || getComputedStyle(p).visibility === 'hidden') return false; const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && r.right>0 && r.left<innerWidth && r.bottom>0 && r.top<innerHeight; })()`), 'first input remains visible and on screen');

  await enter(empty());
  const initialGeometry = await evaluate(rect('[data-slot="top-right"]'));
  await idle(); await visibleInput(); await checkGeometry(initialGeometry);
  assert.equal(await evaluate(opacity('.cc-map-entry')), '0', 'Agent work link fades');
  await shot('empty-idle');

  await enter(full());
  const mapGeometry = await evaluate(rect('[data-thought="sun"]'));
  const toolbarGeometry = await evaluate(rect('.spine-corner'));
  await idle();
  assert.equal(await evaluate(opacity('.spine-corner')), '0', 'Map zoom, Words, Titles, Pictures, See all and Following fade');
  assert.equal(await evaluate(opacity('.spine-corner-right')), '0', 'Shelf fades');
  assert.equal(await evaluate(opacity('.stay-here')), '0', 'idle Stay here controls fade');
  assert.equal(await evaluate(opacity('.map-capture[data-map-capture="active"]')), '0', 'idle input fades on a populated map');
  assert.deepEqual(await evaluate(rect('[data-thought="sun"]')), mapGeometry, 'the visible thought does not jump');
  assert.deepEqual(await evaluate(rect('.spine-corner')), toolbarGeometry, 'camera controls do not jump');
  assert.equal(await evaluate(`document.querySelector('[data-thought="sun"]').textContent.includes('Plant herbs')`), true, 'the thought remains present');
  await shot('full-idle');

  // A first touch reveals the controls without consuming its event.
  await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 800, y: 120 }] });
  assert.equal(await evaluate(opacity('.spine-corner')), '1', 'touch wakes controls immediately');
  await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await move(); await idle();
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate(opacity('[data-slot="top-right"]')), '1', 'the first key reveals controls');
  await evaluate(`document.querySelector('.spine-shelf-head').focus(); window.quietWakeAt=performance.now()`);
  await idle();
  assert.equal(await evaluate('document.activeElement.matches(".spine-shelf-head")'), true, 'idle never moves keyboard focus');
  assert.equal(await evaluate(opacity('.spine-corner-right')), '1', 'focused controls never fade');

  await evaluate(`document.querySelector('textarea[aria-label="Type a thought"]').focus()`);
  await page('Input.insertText', { text: 'Keep the first typed character.' });
  await evaluate('window.quietWakeAt=performance.now()');
  assert.equal(await evaluate(opacity('[data-slot="top-right"]')), '1', 'typing reveals controls');
  await idle(); await visibleInput();
  assert.equal(await evaluate('document.activeElement.value'), 'Keep the first typed character.', 'typing and focus survive idle');
  // During IME composition, a separate deadline signals that the full idle interval elapsed.
  await evaluate(`document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); window.quietCompositionDeadline=false; setTimeout(()=>window.quietCompositionDeadline=true,2200)`);
  await wait('window.quietCompositionDeadline', 'composition spans idle interval');
  assert.equal(await evaluate(opacity('[data-slot="top-right"]')), '1', 'unfinished composition keeps chrome visible');
  await evaluate(`document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})); document.activeElement.blur(); window.quietWakeAt=performance.now()`);
  await idle();

  const example = { id: 'quiet-example', name: 'Example · a garden for everyone', steps: [{ id: 'clarify', name: 'Clarify the idea', prompt: 'Make this garden idea clear.' }] };
  const hash = encodeURIComponent(Buffer.from(JSON.stringify(example)).toString('base64'));
  await enter(full(), `?flow#flow=${hash}`);
  await wait(`!!document.querySelector('.flow-canvas-grid')`, 'Flow is open');
  assert.equal(await evaluate('document.querySelector(".flow-canvas-error")?.textContent ?? ""'), '', 'Flow opens on the happy path');
  await move();
  const flowGeometry = await evaluate(rect('.flow-canvas-body'));
  await idle();
  assert.equal(await evaluate(opacity('.flow-canvas-tools')), '0', 'Flow toolbar fades');
  assert.equal(await evaluate(opacity('.flow-canvas-command')), '0', 'populated Flow command fades');
  assert.equal(await evaluate(opacity('.flow-canvas-box')), '1', 'Flow content stays visible');
  assert.deepEqual(await evaluate(rect('.flow-canvas-body')), flowGeometry, 'Flow does not jump');
  await shot('flow-idle');
  await move();
  await evaluate(`document.querySelector('.flow-canvas-command textarea').focus()`);
  await page('Input.insertText', { text: 'Keep this Flow draft' });
  await evaluate('window.quietWakeAt=performance.now()'); await idle();
  assert.equal(await evaluate(opacity('.flow-canvas-command')), '1', 'focused Flow input stays visible');
  assert.equal(await evaluate('document.activeElement.value'), 'Keep this Flow draft');

  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await enter(empty(), '', 390); await idle(); await visibleInput(); await shot('phone-empty-idle');
  assert.equal(await evaluate('window.quietCaptureCalls'), 0, 'no microphone requested');
  assert.ok(!core.heard.some(m => ['flow', 'listen', 'mic'].includes(m.type)), 'no model or microphone action sent');
  console.log(`PASS quiet-screen-check: empty, full, Flow, focus, typing, IME, touch, stable layout, reduced-motion phone. Screenshots: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  core.close();
}
