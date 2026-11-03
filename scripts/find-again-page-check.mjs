// Built pages in real headless Chrome. FIND_MAP_URL may serve a copied real map for Titles.
// SHOTS saves the three acceptance pages; no model or key is needed.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

if (ready()) { console.log(`SKIP find-again-page-check: ${ready()}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const empty = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], topics: {} };
const thread = (id, title) => ({ id, title, parent_id: null, status: 'open', last_point: '', touched_ms: Date.now(), tags: [], picture: null, dropped_by: '' });
const original = 'I will record the hackathon demo after breakfast. I want to show one clear conversation and keep every thought, even when I change my mind halfway through.';
const thought = (id, text, point, thread_id) => ({ id, speaker: 'you', text, point, thread_id, placed: true, unclear: '', complete: true, at_ms: Date.now(), place_ms: 2000 });
let world = { ...empty, threads: [thread('demo', 'Hackathon demo recording'), thread('elsewhere', 'Something else')],
  thoughts: [thought('breakfast', original, 'Record one clear conversation', 'demo'), ...Array.from({ length: 20 }, (_, i) => thought(`later-${i}`, `Later thought ${i} about recording`, `Later thought ${i} about recording`, 'demo')), thought('latest', 'Use the quiet room for recording', 'Use the quiet room', 'demo'), thought('else', 'Buy coffee on the way home', 'Buy coffee', 'elsewhere')], active: 'elsewhere', active_by: { you: 'elsewhere' } };
let online = true;
let loseFirstAck = true;
const landed = new Map();
const core = await standInCore(() => online ? [{ type: 'snapshot', world }] : null, { onMessage(message) {
  if (message.type === 'text') {
    if (!landed.has(message.id)) landed.set(message.id, message.text);
    if (loseFirstAck) { loseFirstAck = false; online = false; core.drop(); return; }
    core.send({ type: 'text_received', id: message.id });
  }
  if (message.type === 'focus') {
    world = { ...world, active: message.thread_id, active_by: { you: message.thread_id } };
    core.send({ type: 'change', change: { type: 'active_changed', thread_id: message.thread_id, speaker: 'you' } });
  }
} });
assert.ok(core.port >= 4620, `spare port: ${core.port}`);
let scene;
try {
  scene = await openPage(`http://127.0.0.1:${core.port}/`);
  const { page, evaluate, until } = scene;
  const shot = async (name) => {
    if (!shots) return;
    const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  };
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000), 'map opens');
  await evaluate(`window.__errors = []; addEventListener('error', e => { if (!e.message.includes('ResizeObserver')) __errors.push(e.message); });`);
  const enter = async () => {
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const type = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page('Input.insertText', { text });
  };
  for (const width of [1440, 390]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await type('input[type=search]', 'breakfast');
    assert.ok(await until(`document.querySelector('.shell-find-row')?.textContent.includes('Hackathon')`), 'word finds topic');
    if (width === 1440) await enter();
    else await evaluate(`document.querySelector('.shell-find-row').click()`);
    assert.ok(await until(`document.querySelector('[data-thought="breakfast"] .spine-words')?.textContent === ${JSON.stringify(original)}`), 'the matching thought shows its original words');
    await sleep(3200); // Beyond the camera follow's 2.5 s spacing: it must stay on the match.
    const rect = await evaluate(`(() => { const e = document.querySelector('[data-thought="breakfast"] .spine-text'); const r = e.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, height:innerHeight, width:innerWidth }; })()`);
    assert.ok(rect.top >= 0 && rect.bottom < rect.height - 100 && rect.left >= 0 && rect.right <= rect.width, `original words in view at ${width}: ${JSON.stringify(rect)}`);
    await shot(`search-${width}`);
  }
  console.log('PASS search: keyboard and pointer go to the matching original words, desktop and phone');

  online = false;
  core.drop();
  assert.ok(await until(`document.body.textContent.includes('Connecting…')`), 'offline');
  const queued = 'Keep the thought I typed while disconnected';
  await type('textarea[aria-label="Type a thought"]', queued);
  await enter();
  assert.ok(await until(`document.body.textContent.includes('1 to send when connected')`), 'queued count');
  assert.ok(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.waiting.you')).some(m => JSON.parse(m).text === ${JSON.stringify(queued)})`), 'saved before draft cleared');
  await page('Page.navigate', { url: 'about:blank' });
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until(`document.body.textContent.includes('1 to send when connected')`, 10000), 'queue survives reopening');
  await shot('offline-reopened');
  online = true;
  for (let i = 0; i < 200 && !landed.size; i++) await sleep(50);
  assert.equal(landed.size, 1, 'first send reached the server before the socket dropped');
  assert.ok(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.waiting.you')).length === 1`), 'send without acknowledgment keeps saved entry');
  await page('Page.navigate', { url: 'about:blank' });
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until(`document.body.textContent.includes('1 to send when connected')`, 10000), 'lost acknowledgment survives reopening');
  online = true;
  assert.ok(await until(`!document.body.textContent.includes('1 to send when connected')`, 20000), 'reconnect drains queue');
  assert.equal(core.heard.filter(m => m.type === 'text' && m.text === queued).length, 2, 'unacknowledged send retried');
  core.drop();
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000), 'reopened online');
  await sleep(1000);
  assert.equal(core.heard.filter(m => m.type === 'text' && m.text === queued).length, 2, 'acknowledged thought is never replayed');
  assert.equal(landed.size, 1, 'retry lands exactly once');
  // A failed browser save must leave the draft in the field.
  online = false;
  core.drop();
  assert.ok(await until(`document.body.textContent.includes('Connecting…')`), 'offline again');
  await evaluate(`Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError'); }`);
  await type('textarea[aria-label="Type a thought"]', 'Keep this draft if saving fails');
  await enter();
  assert.ok(await until(`document.body.textContent.includes("Couldn't save this thought")`), 'save failure explained');
  assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Type a thought"]').value`), 'Keep this draft if saving fails');
  console.log('PASS offline: socket drops after send, saved entry survives reopening, same id retries and lands once; failed save keeps draft');

  online = true;
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (process.env.FIND_MAP_URL) await page('Page.navigate', { url: process.env.FIND_MAP_URL });
  else await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 10000), 'real map opens');
  await evaluate(`document.querySelectorAll('.spine-stop')[1].click()`);
  await sleep(1000);
  const labels = await evaluate(`(() => {
    const zoom = Number(document.querySelector('.react-flow__viewport').style.transform.match(/scale\\(([\\d.]+)\\)/)[1]);
    return { zoom, rows: [...document.querySelectorAll('.spine-head .spine-label')].map(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); const broken = [...e.textContent.matchAll(/\\S+/g)].filter(word => { const range = document.createRange(); range.setStart(e.firstChild, word.index); range.setEnd(e.firstChild, word.index + word[0].length); return range.getClientRects().length > 1; }).map(word => word[0]); return { text: e.textContent, width: r.width, font:parseFloat(c.fontSize)*zoom, broken }; }) };
  })()`);
  assert.ok(labels.rows.length > 0, 'Titles has names');
  for (const label of labels.rows) {
    assert.ok(label.font >= 12.9, `readable type: ${JSON.stringify(label)}`);
    assert.deepEqual(label.broken, [], `whole words: ${label.text}`);
  }
  await shot('titles-real-map');
  console.log(`PASS Titles: ${labels.rows.length} readable names at zoom ${labels.zoom.toFixed(3)}`);
} finally {
  await scene?.close();
  core.close();
}
