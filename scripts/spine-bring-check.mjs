// Synthetic mounted app, installed Chrome, owned ephemeral HTTP/WS server. No model or account.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

if (ready()) { console.log(`SKIP i-bring-check: ${ready()}`); process.exit(3); }
const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: 'open', last_point: '', touched_ms: now, tags: [], picture: null, dropped_by: '' });
const thought = (id, at, text, point, thread_id = 'target') => ({ id, speaker: 'you', text, point, thread_id, placed: true, unclear: '', complete: true, at_ms: now + at, place_ms: 2000 });
const title = 'Synthetic observatory rehearsal — complete title with the final words intact';
let world = {
  threads: [thread('target', title), thread('current', 'Synthetic garden'), thread('third', 'Synthetic afternoon')],
  // Deliberately out of time order: inspection must order points and retain the complete source words.
  thoughts: [thought('later', 2, 'Second original source: retain this entire sentence.', 'Second point'), thought('first', 1, 'First original source: rehearse under the stars.', 'First point'), thought('other', 3, 'Water the synthetic seedlings.', 'Water seedlings', 'current')],
  active: 'current', active_by: { you: 'current' }, suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
  positions: { target: { x: 50, y: 80, by: 'you', at_ms: now }, current: { x: 800, y: 80, by: 'you', at_ms: now }, third: { x: 1500, y: 80, by: 'you', at_ms: now } },
};
const core = await standInCore(() => [{ type: 'snapshot', world }], { onMessage(message) {
  if (message.type === 'focus') {
    world = { ...world, active: message.thread_id, active_by: { you: message.thread_id } };
    core.send({ type: 'change', change: { type: 'active_changed', thread_id: message.thread_id, speaker: 'you' } });
  }
} });
assert.ok(![4360, 4399].includes(core.port));
let scene;
try {
  scene = await openPage(`http://127.0.0.1:${core.port}/`);
  const { page, evaluate, until } = scene;
  const key = async (key, code = key) => {
    const windowsVirtualKeyCode = { Enter: 13, Escape: 27, Tab: 9 }[key];
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text: key === 'Enter' ? '\r' : undefined });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  };
  const click = async selector => {
    const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await page('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p });
    await page('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p });
  };
  const type = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page('Input.insertText', { text });
  };
  const shot = async name => {
    if (!process.env.SHOTS) return;
    mkdirSync(process.env.SHOTS, { recursive: true });
    const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(process.env.SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000), 'mounted Canvas');
  const instrumentation = `window.__errors=[]; addEventListener('error',e=>{if(!e.message.includes('ResizeObserver')) __errors.push(e.message)});
    window.__world = () => {
      const element = document.querySelector('.app');
      let fiber = element[Object.keys(element).find(k=>k.startsWith('__reactFiber'))];
      for (; fiber; fiber=fiber.return) for(let hook=fiber.memoizedState; hook; hook=hook.next) {
        const value=hook.memoizedState;
        if(value && Array.isArray(value.threads) && Array.isArray(value.thoughts)) return value;
      }
      throw Error('Mounted World not found');
    };
    window.__state = () => ({camera:document.querySelector('.react-flow__viewport').style.transform,
      positions:__world().positions, active:__world().active, active_by:__world().active_by,
      selection:[...document.querySelectorAll('.react-flow__node.selected')].map(e=>e.dataset.id),
      source:[...document.querySelectorAll('.react-flow__node')].map(e=>[e.dataset.id,e.style.transform]),
      draft:document.querySelector('textarea[aria-label="Type a thought"]').value,
      cursor:[document.querySelector('textarea[aria-label="Type a thought"]').selectionStart,document.querySelector('textarea[aria-label="Type a thought"]').selectionEnd]});`;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
  await evaluate(instrumentation);
  assert.deepEqual(await evaluate(`__world().positions`), world.positions, 'read actual mounted World');
  await click('[data-guide="catalog"]');
  assert.equal(await evaluate(`document.querySelector('[data-row="bring-here"] [role="switch"]').getAttribute('aria-checked')`), 'false', 'fresh profile defaults off');
  await click('.shell-rail-close');
  await type('input[type=search]', 'observatory');
  assert.ok(await until(`!!document.querySelector('.shell-find-row')`));
  assert.equal(await evaluate(`!!document.querySelector('.bring-here-action')`), false, 'no new action while off');
  await key('Escape');
  await click('[data-guide="catalog"]');
  await click('[data-row="bring-here"] [role="switch"]');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.features'))['bring-here']`), true, 'enabled through Features');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000));
  await sleep(800);
  const initialCamera = await evaluate(`__state().camera`);
  await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1000, y: 400, deltaX: 2400, deltaY: 900 });
  await sleep(500);
  assert.notEqual(await evaluate(`__state().camera`), initialCamera, 'pan far away before inspecting');
  assert.ok(await evaluate(`(() => {const e=document.querySelector('.spine-head[data-thread="target"]');if(!e)return true;const r=e.getBoundingClientRect();return r.right<0||r.bottom<0||r.left>innerWidth||r.top>innerHeight})()`), 'target outside viewport');
  await type('textarea[aria-label="Type a thought"]', 'Synthetic unfinished draft stays here');
  await evaluate(`document.querySelector('textarea[aria-label="Type a thought"]').setSelectionRange(10,19)`);
  await type('input[type=search]', 'observatory');
  assert.ok(await until(`!!document.querySelector('.bring-here-action')`), 'enabled action survives reload');
  const before = await evaluate(`__state()`);
  const messages = core.heard.length;
  const searchCursor = await evaluate(`document.querySelector('input[type=search]').selectionStart`);
  await click('.bring-here-action');
  assert.ok(await until(`!!document.querySelector('.bring-here')`));
  assert.deepEqual(await evaluate(`__state()`), before, 'camera x/y/zoom, every World position, source, selection, active and draft/cursor unchanged');
  assert.ok(await evaluate(`document.activeElement === document.querySelector('input[type=search]')`), 'pointer open preserves active input');
  assert.equal(await evaluate(`document.activeElement.selectionStart`), searchCursor, 'active input cursor preserved');
  assert.equal(await evaluate(`document.querySelector('.bring-here h2').textContent`), title, 'complete title');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.bring-here li')].map(e=>e.textContent)`), ['First pointFirst original source: rehearse under the stars.', 'Second pointSecond original source: retain this entire sentence.'], 'ordered points and source words');
  assert.ok(await evaluate(`document.querySelector('.bring-here-id').textContent.includes('target')`), 'stable ID');
  assert.equal(core.heard.slice(messages).filter(m => !['heartbeat', 'attend', 'visible'].includes(m.type)).length, 0, 'inspection sends no map command');
  await shot('inspect-desktop');
  core.send({ type: 'change', change: { type: 'thread_renamed', thread_id: 'target', title: `${title} — live` } });
  core.send({ type: 'change', change: { type: 'thought_repointed', thought_id: 'first', point: 'Updated live point' } });
  assert.ok(await until(`document.querySelector('.bring-here h2')?.textContent.endsWith('— live') && document.querySelector('.bring-here li')?.textContent.startsWith('Updated live point')`), 'live source update linked');
  await key('Escape');
  assert.ok(await until(`!document.querySelector('.bring-here') && document.activeElement?.matches('.bring-here-action')`), 'Escape closes with result focus return');
  assert.deepEqual(await evaluate(`__state()`), before, 'closing leaves source/camera/draft unchanged');
  await key('Enter');
  assert.ok(await until(`!!document.querySelector('.bring-here')`), 'keyboard opens inspection'); 
  await click('.bring-here footer button');
  assert.ok(await until(`!document.querySelector('.bring-here') && __state().camera !== ${JSON.stringify(before.camera)}`), 'Open original deliberately navigates');
  assert.ok(core.heard.some(m => m.type === 'focus' && m.thread_id === 'target'), 'existing focus path');

  // Make a real History landing with a synthetic source change.
  const landed = thought('history-point', 4, 'Synthetic History source words', 'History point');
  core.send({ type: 'change', change: { type: 'thought_added', thought: { ...landed, placed: false, thread_id: null } } });
  core.send({ type: 'change', change: { type: 'thought_placed', thought_id: landed.id, thread_id: 'target', point: landed.point, unclear: '', place_ms: 2000 } });
  await evaluate(`document.activeElement?.blur()`);
  await key('y', 'KeyY');
  assert.ok(await until(`[...document.querySelectorAll('.shell-history-meta button')].some(e=>e.textContent==='Inspect here')`), 'History row offers Inspect here'); 
  await sleep(1200); // Let the injected point's existing layout motion finish before comparing source positions.
  await evaluate(`window.__historyInspect=[...document.querySelectorAll('.shell-history-meta button')].find(e=>e.textContent==='Inspect here'); __historyInspect.focus()`);
  await key('Enter');
  assert.ok(await until(`!!document.querySelector('.bring-here')`));
  const historyBefore = await evaluate(`__state()`);
  await click('.bring-here header button');
  assert.ok(await until(`document.activeElement === __historyInspect`), 'History focus return');
  assert.deepEqual(await evaluate(`__state()`), historyBefore, 'History close preserves camera and draft');
  await click('.shell-rail-close');

  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await type('input[type=search]', 'observatory');
  assert.ok(await until(`!!document.querySelector('.bring-here-action')`));
  await click('.bring-here-action');
  assert.ok(await until(`!!document.querySelector('.bring-here')`));
  assert.ok(await evaluate(`(() => {const r=document.querySelector('.bring-here').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight-80})()`), '390px panel within visible area');
  await shot('inspect-390');
  core.send({ type: 'snapshot', world: { ...world, threads: world.threads.filter(t=>t.id!=='target'), thoughts: world.thoughts.filter(t=>t.thread_id!=='target') } });
  assert.ok(await until(`document.querySelector('.bring-here')?.textContent.includes('Source no longer on map')`), 'deleted source has explicit state');
  assert.ok(await evaluate(`document.querySelector('.bring-here footer button').disabled`));
  core.send({ type: 'snapshot', world });
  assert.ok(await until(`!!document.querySelector('.bring-here h2')`));
  await key('Escape');
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('[data-guide="catalog"]');
  // Switch off while the panel is open: its view and actions disappear, only.
  await evaluate(`document.querySelector('.bring-here-action').click()`);
  assert.ok(await until(`!!document.querySelector('.bring-here')`));
  await click('[data-row="bring-here"] [role="switch"]');
  assert.ok(await until(`!document.querySelector('.bring-here') && !document.querySelector('.bring-here-action')`), 'disable removes action and panel');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000));
  await type('input[type=search]', 'observatory');
  assert.ok(await until(`!!document.querySelector('.shell-find-row')`));
  assert.equal(await evaluate(`!!document.querySelector('.bring-here-action')`), false, 'off persists after reload');
  await key('Enter');
  assert.ok(await until(`!document.querySelector('input[type=search]').value`), 'ordinary Find still navigates');
  assert.deepEqual(await evaluate(`__errors`), []);
  console.log('i-bring-check: ok (default off; Features/reload; Find + History; unchanged camera/World/draft; live update/deletion; focus return; Open original; disable; desktop + 390px/reduced motion)');
} finally {
  await scene?.close();
  core.close();
}
