import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage, ready, standInCore } from '../../../../scripts/headless.mjs';

assert.equal(ready(), '', ready());
const folder = dirname(fileURLToPath(import.meta.url));
assert.equal(JSON.parse(readFileSync(join(folder, 'brick.json'))).defaultOn, false);
mkdirSync(join(folder, '.check-artifacts'), { recursive: true });
const artifacts = mkdtempSync(join(folder, '.check-artifacts/run-'));
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: 'open', last_point: '', touched_ms: 3000, tags: [], picture: null, dropped_by: '' });
const thought = (id, point, thread_id, at_ms, text = point) => ({ id, point, text, thread_id, at_ms,
  speaker: 'Example speaker', placed: true, unclear: '', complete: true, place_ms: null });
const original = 'Keep this exact, older sentence.\nAnd this second line, too.';
let world = {
  threads: [thread('a', 'First topic'), thread('b', 'Second topic'), thread('note', 'A reply', 'a')],
  thoughts: [thought('old', 'The idea we began with', 'b', 1000, original),
    thought('same-time', 'A separate thought at the same time', 'a', 1000),
    thought('new', 'The decision we reached', 'b', 2000), thought('reply', 'An anchored reply', 'note', 3000),
    { ...thought('waiting', 'Not ready', 'a', 4000), placed: false }, thought('orphan', 'Missing topic', 'gone', 5000)],
  active: 'a', active_by: { you: 'a' }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], positions: {}, anchors: { note: { thought_id: 'same-time', quote: 'thought' } }, ai: [],
};
const core = await standInCore(() => [{ type: 'snapshot', world }], { port: 4587 });
let scene;
try {
  scene = await openPage(`http://127.0.0.1:${core.port}/`, { width: 1440, height: 1100, debugPort: 4588, preserveProfile: true });
  const { page, evaluate, until } = scene;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.replayErrors=[]; window.resizeNotices=[]; window.micAttempts=0;
    addEventListener('error',e=>{
      // Browser layout scheduling notices also occur on the initial Canvas before replay is enabled.
      // Script exceptions and rejected promises remain failures; geometry has separate visible assertions.
      if(e.message==='ResizeObserver loop completed with undelivered notifications.') resizeNotices.push(e.message);
      else replayErrors.push(e.message);
    });
    addEventListener('unhandledrejection',e=>replayErrors.push(String(e.reason)));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{micAttempts++; return Promise.reject(Error('Mic forbidden'));};
  ` });
  await page('Page.reload');
  const wait = async (condition, description) => assert.ok(await until(condition, 12000), description);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = label => evaluate(`(()=>{const button=[...document.querySelectorAll('.thought-replay button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});button.focus();button.click();})()`);
  const current = () => evaluate(`document.querySelector('.thought-replay-stop')?.dataset.replayId`);
  const expectStop = id => wait(`document.querySelector('.thought-replay-stop')?.dataset.replayId === ${JSON.stringify(id)}`, `Exact stop ${id}`);
  const order = async value => {
    await evaluate(`(()=>{const select=document.querySelector('.thought-replay-controls select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const show = async () => {
    await wait(`!!document.querySelector('.thought-replay-launcher:not([hidden])')`, 'Replay launcher ready');
    await click('.thought-replay-launcher');
    await wait(`!!document.querySelector('.thought-replay')`, 'Replay visible');
    assert.ok(await evaluate(`document.querySelector('.thought-replay h1').getBoundingClientRect().top < innerHeight / 2`), 'Replay opens visibly at the top of the viewport');
  };
  const press = async key => {
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
  };
  await wait(`!!document.querySelector('.spine-ready')`, 'Initial canvas');
  console.log('Initial Canvas browser resize notices:', await evaluate('resizeNotices.length'));
  assert.equal(await evaluate(`!!document.querySelector('.thought-replay')`), false);
  await click('[data-guide=catalog]');
  await wait(`!!document.querySelector('[data-row="thought-replay"] [role=switch]')`, 'Switch available');
  assert.equal(await evaluate(`document.querySelector('[data-row="thought-replay"] [role=switch]').getAttribute('aria-checked')`), 'false');
  await click('[data-row="thought-replay"] [role=switch]');
  await click('[data-guide=catalog]');
  await show();
  await expectStop('old');
  assert.match(await evaluate(`document.querySelector('.thought-replay-progress').textContent`), /Stop 1 of 4/);
  await click('.thought-replay-original summary');
  assert.equal(await evaluate(`document.querySelector('.thought-replay-original p').textContent`), original);
  await button('Next'); await expectStop('same-time');
  await button('Next'); await expectStop('new');
  await order('topic'); await expectStop('new');
  await button('Previous'); await expectStop('old');
  await button('Previous'); await expectStop('same-time');
  await button('Next'); await expectStop('old');
  // Opening the older source must highlight it even though a newer thought shares its topic.
  await click('.thought-replay-source');
  await wait(`document.querySelector('[data-thought="old"] .spine-words')?.textContent === ${JSON.stringify(original)}`, 'Exact older source on canvas');
  await wait(`!!document.activeElement?.closest('[data-thought="old"]')`, 'Exact source receives focus');
  await show(); await expectStop('old');
  assert.equal(await evaluate(`document.querySelector('.thought-replay-controls select').value`), 'topic', 'Order survives jump and return');
  assert.equal(await evaluate(`document.querySelector('.thought-replay-play').textContent`), 'Play', 'Return stays paused');
  // Pace is based on a real visible interval, then the next distinct thought appears.
  await order('time'); await button('Play');
  assert.equal(await current(), 'old', 'Play leaves the first stop readable');
  await expectStop('same-time');
  await button('Pause');
  await button('Play');
  await evaluate(`document.querySelector('textarea, input[type=text]').focus()`);
  await wait(`document.querySelector('.thought-replay-play').textContent === 'Play'`, 'Typing pauses playback');
  await button('Play');
  core.drop();
  await wait(`document.querySelector('.thought-replay-progress').textContent.includes('Map disconnected')`, 'Disconnected status visible');
  await wait(`document.querySelector('.thought-replay-play').textContent === 'Play'`, 'Disconnect pauses playback');
  await wait(`document.querySelector('.thought-replay-play').disabled === false`, 'Map reconnects');
  await expectStop('same-time');
  // A removed selected record remains readable instead of changing identity.
  world = { ...world, thoughts: world.thoughts.filter(t => t.id !== 'same-time') };
  core.send({ type: 'snapshot', world });
  await wait(`!!document.querySelector('.thought-replay-warning')`, 'Removed source explained');
  assert.equal(await current(), 'same-time');
  assert.equal(await evaluate(`document.querySelector('.thought-replay-source').disabled`), true);
  await button('Next'); await expectStop('new');
  await button('Next'); await expectStop('reply');
  assert.match(await evaluate(`document.querySelector('.thought-replay-progress').textContent`), /End of trail/);
  assert.equal(await evaluate(`[...document.querySelectorAll('.thought-replay button')].find(b=>b.textContent==='Next').disabled`), true);
  world = { ...world, thoughts: world.thoughts.filter(t => t.id !== 'reply') };
  core.send({ type: 'snapshot', world });
  await wait(`!!document.querySelector('.thought-replay-warning')`, 'Removed final stop remains visible');
  await button('Previous'); await expectStop('new');
  for (const [width, height, scheme] of [[1440, 1100, 'light'], [1440, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(`document.documentElement.scrollWidth <= innerWidth + 1`, 'No horizontal overflow');
    assert.deepEqual(await evaluate(`(()=>{const root=document.querySelector('.thought-replay');return [...root.querySelectorAll('button,select')].filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.textContent)})()`), [], 'Controls fit');
    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${width}-${scheme}.png`), Buffer.from(shot.data, 'base64'));
  }
  await evaluate(`document.querySelector('.thought-replay').focus()`);
  await press('Escape');
  await wait(`!document.querySelector('.thought-replay')`, 'Escape returns to map');
  assert.equal(await evaluate(`document.activeElement === document.querySelector('.thought-replay-launcher')`), true, 'Escape restores launcher focus');
  assert.equal(await evaluate('micAttempts'), 0);
  assert.deepEqual(await evaluate('replayErrors'), []);
  // The playground empty state must show a labelled, useful example without mutating the map.
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/bricks.html?brick=thought-replay&sample=empty` });
  await wait(`!!document.querySelector('.thought-replay-launcher')`, 'Empty playground discovers replay');
  await show();
  await expectStop('example-1');
  assert.match(await evaluate(`document.querySelector('.thought-replay-context').textContent`), /Example replay · not live AI/);
  assert.equal(await evaluate(`document.querySelector('.thought-replay-source').disabled`), true);
  await order('topic'); await button('Next'); await expectStop('example-3');
  await button('Use your map');
  await wait(`document.querySelector('.thought-replay-progress').textContent.includes('No placed thoughts')`, 'Live empty state explained');
  assert.equal(await evaluate(`document.querySelector('.playground-log ol') === null`), true, 'Example sends no host actions');
  assert.equal(await evaluate('micAttempts'), 0);
  assert.deepEqual(await evaluate('replayErrors'), []);
  console.log('PASS thought-replay: ordered distinct stops, exact original jump and return, reading clock, edit/disconnect pause, reconnect, removed source, end, phone/desktop light/dark, empty example; mic blocked.');
  console.log(`Screenshots retained: ${artifacts}`);
} finally {
  await scene?.close();
  core.close();
}
