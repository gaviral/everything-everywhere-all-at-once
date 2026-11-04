// Synthetic state only. The existing stand-in core and Chrome helpers own their sockets/profiles/PIDs.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';
import { uiServer } from './ui-server.mjs';

// openPage inherits this environment: no provider or connector credentials reach its child.
for (const name of Object.keys(process.env)) {
  if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|MESSAGES_|NOTES_|PUBLIC_URL|ROOM_CODE/i.test(name)) delete process.env[name];
}
process.env.TZ = 'America/Vancouver';
assert.equal(ready(), '', ready());
const shots = mkdtempSync(join(tmpdir(), 'f7-find-'));
const day1 = new Date(2026, 5, 10, 9).getTime();
const day2 = new Date(2026, 5, 11, 9).getTime();
const thought = (id, text, thread_id = 'a', speaker = 'Speaker One', at_ms = day1, point = text) =>
  ({ id, text, point, thread_id, speaker, at_ms, placed: true, unclear: '', complete: true, place_ms: null });
const thread = (id, title) => ({ id, title, parent_id: null, status: 'open', last_point: '', touched_ms: day2, tags: [], picture: null, dropped_by: '' });
const original = 'Amber river: keep the exact older sentence, with its punctuation.\nThis second line is also original.';
let world = {
  threads: [thread('a', 'Field study'), thread('b', 'Workshop'), thread('c', 'Unsorted notes')],
  thoughts: [thought('older', original, 'a', 'Speaker One', day1, 'Amber river observation'),
    thought('other-speaker', 'Amber river', 'a', 'Speaker Two'), thought('other-day', 'Amber river', 'a', 'Speaker One', day2),
    thought('other-theme', 'Amber river', 'b'), thought('split-amber', 'Amber only', 'a'), thought('split-river', 'River only', 'a'),
    thought('unicode', 'CAFÉ 東京 botanical'), thought('unknown', 'Undated marker', 'c', 'Speaker Two', 0),
    ...Array.from({ length: 120 }, (_, i) => thought(`batch-${String(i).padStart(3, '0')}`, `Pagination marker ${i}`, 'b', 'Speaker Two', day2 + i)),
    { ...thought('waiting', 'Amber river'), placed: false }, thought('missing-topic', 'Amber river', 'gone')],
  topics: { a: 'Research', b: 'Making' }, active: 'b', active_by: { you: 'b' }, suggestions: [], actions: [], merged: {}, apps: [],
  apps_seeded: true, recaps: [], notes: {}, proposals: [], positions: {}, anchors: {}, ai: [],
};

// Supplemental pure edge cases; the browser below checks the actual enabled view.
const modules = await uiServer();
try {
  const { sourceFields, filterSources, localDay } = await modules.ssrLoadModule('/src/bricks/focused-find/rules.ts');
  const rows = sourceFields(world.thoughts, world.threads.map(t => ({ ...t, topic: world.topics[t.id] })));
  const filter = query => filterSources(rows, { query, speaker: null, theme: null, day: '' }).map(r => r.thought.id);
  assert.deepEqual(filter('café 東'), ['unicode']);
  assert.deepEqual(filter('cafe\u0301'), ['unicode'], 'canonical Unicode forms');
  assert.deepEqual(filter('amber river field'), ['other-day', 'older', 'other-speaker'], 'AND across this thought and its topic title');
  assert.deepEqual(filter('only river amber'), [], 'separate thoughts cannot combine');
  assert.deepEqual(filter('!!!'), [], 'punctuation is not an entire-map query');
  assert.equal(localDay(0), '');
  assert.equal(localDay(new Date(2026, 5, 10, 23, 59).getTime()), '2026-06-10');
} finally { await modules.close(); }

let connections = 0;
const core = await standInCore(() => { connections++; return [{ type: 'snapshot', world }]; });
assert.ok(![4360, 4399].includes(core.port), 'ephemeral test port');
let scene;
try {
  scene = await openPage(`http://127.0.0.1:${core.port}/`);
  const { page, evaluate, until } = scene;
  const requests = [];
  scene.on('Network.requestWillBeSent', event => requests.push(event.request.url));
  await page('Network.enable');
  await page('Page.reload');
  await page('Emulation.setTimezoneOverride', { timezoneId: 'America/Vancouver' });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.__findErrors=[]; addEventListener('error',e=>{if(!e.message.includes('ResizeObserver')) __findErrors.push(e.message)});` });
  const key = async (key, code = key, virtual = 0) => {
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual, ...(key === 'Enter' ? { text: '\r' } : key === ' ' ? { text: ' ' } : {}) });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual });
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const field = async (selector, value) => {
    await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  };
  const words = async text => {
    await field('.focused-find input[type=search]', '');
    await focus('.focused-find input[type=search]');
    await page('Input.insertText', { text });
    assert.equal(await evaluate(`document.querySelector('.focused-find input[type=search]').value`), text, 'input stays responsive');
    assert.ok(await until(`!document.querySelector('.focused-find-status').textContent.includes('Updating')`));
  };
  const ids = () => evaluate(`[...document.querySelectorAll('[data-focused-thought]')].map(e=>e.dataset.focusedThought)`);
  const catalog = async () => { await click('[data-guide=catalog]'); assert.ok(await until(`!!document.querySelector('[data-row="focused-find"]')`)); };
  const show = async () => {
    await catalog(); await click('[data-row="focused-find"] .shell-link');
    assert.ok(await until(`!!document.querySelector('.focused-find input')`));
    assert.ok(await until(`document.activeElement === document.querySelector('.focused-find input')`), 'focus enters form');
  };
  const screenshot = async name => {
    const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const layout = async () => {
    const bad = await evaluate(`(() => { const scope=document.querySelector('.focused-find'); return [...scope.querySelectorAll('input,select,button,summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width<1 || r.left<0 || r.right>innerWidth+1 || e.scrollWidth>e.clientWidth+2}).map(e=>e.outerHTML); })()`);
    assert.deepEqual(bad, [], 'essential controls fit without horizontal clipping');
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth+1`), 'no horizontal page overflow');
  };
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 15000), 'baseline canvas');
  assert.equal(await evaluate(`!!document.querySelector('[data-brick="focused-find"]')`), false);
  const baseline = core.heard.length;
  await sleep(250);
  assert.deepEqual(core.heard.slice(baseline).filter(m => !['heartbeat','this','read'].includes(m.type)), [], 'fresh storage has no feature messages');
  assert.deepEqual(requests.filter(url => /focused-find|\/images\//.test(url)), [], 'off means no feature code or picture warm requests');
  await catalog();
  assert.equal(await evaluate(`document.querySelector('[data-row="focused-find"] [role=switch]').getAttribute('aria-checked')`), 'false');
  await focus('[data-row="focused-find"] [role=switch]');
  await key(' ', 'Space', 32);
  assert.ok(await until(`document.querySelector('[data-row="focused-find"] [role=switch]')?.getAttribute('aria-checked') === 'true'`), 'keyboard enable through Features');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 15000));
  await show();
  assert.equal(await evaluate(`document.querySelector('.focused-find-status').textContent`), 'Choose a filter or type words');
  assert.deepEqual(await ids(), []);
  await key('Tab', 'Tab', 9);
  assert.equal(await evaluate(`document.activeElement.tagName`), 'SELECT', 'native keyboard traversal');
  await words('AMBER river');
  await field('.focused-find select', JSON.stringify('Speaker One'));
  await field('.focused-find input[type=date]', '2026-06-10');
  await field('.focused-find label:nth-child(3) select', JSON.stringify('Research'));
  assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 1`));
  assert.deepEqual(await ids(), ['older'], 'query, speaker, theme and local day intersect exactly');
  await focus('.focused-find summary'); await key('Enter', 'Enter', 13);
  assert.ok(await until(`!!document.querySelector('.focused-find details[open] p')`), 'keyboard opens original words');
  assert.equal(await evaluate(`document.querySelector('.focused-find details[open] p').textContent`), original, 'exact original disclosure');
  await layout(); await screenshot('desktop');
  await focus('.focused-find-result button'); await key('Enter', 'Enter', 13);
  assert.ok(await until(`document.querySelector('[data-thought="older"] .spine-words')?.textContent === ${JSON.stringify(original)}`, 15000), 'older exact source opens');
  assert.ok(await until(`document.activeElement?.closest('[data-thought="older"]') && document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2`), 'exact source highlighted and focused');
  await sleep(800);
  const destination = await evaluate(`(() => { const r=document.querySelector('[data-thought="older"] .spine-text').getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, right:r.right }; })()`);
  assert.ok(destination.top >= 0 && destination.bottom < 800 && destination.left >= 0 && destination.right <= 1440, 'exact older destination is in view');
  await screenshot('opened-original');
  await show();
  assert.deepEqual(await ids(), [], 'filters are mounted-view state only');
  await words('only amber river');
  assert.ok(await until(`document.querySelector('.focused-find-status').textContent === 'No matching thoughts'`));
  assert.deepEqual(await ids(), [], 'tokens in different thoughts do not combine');
  await click('.focused-find-form button');
  await field('.focused-find label:nth-child(3) select', JSON.stringify(''));
  assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 1`));
  assert.deepEqual(await ids(), ['unknown'], 'No theme is a usable filter');
  assert.ok(await evaluate(`document.querySelector('.focused-find-meta').textContent.includes('Unknown date')`));
  await field('.focused-find input[type=date]', '2026-06-10');
  assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 0`));
  assert.deepEqual(await ids(), [], 'timestamp zero never matches a day');
  await click('.focused-find-form button'); await words('pagination marker');
  assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 50`));
  assert.equal(await evaluate(`document.querySelector('.focused-find-status').textContent`), 'Showing 50 of 120 matching thoughts');
  await click('.focused-find > button'); assert.equal((await ids()).length, 100);
  await click('.focused-find > button'); assert.equal((await ids()).length, 120);
  assert.equal(await evaluate(`document.querySelector('.focused-find-status').textContent`), 'Showing 120 of 120 matching thoughts');
  assert.deepEqual((await ids()).slice(0, 2), ['batch-119', 'batch-118']);
  await words('café 東'); assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 1`));
  assert.deepEqual(await ids(), ['unicode']);
  core.send({ type: 'change', change: { type: 'thought_added', thought: thought('new-source', 'Café 東京', 'a', 'Speaker One', day2 + 500) } });
  assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 2`), 'new data appears immediately');
  core.send({ type: 'change', change: { type: 'thought_placed', thought_id: 'new-source', thread_id: 'b', point: 'Revised source', unclear: '', complete: true, place_ms: null } });
  await field('.focused-find label:nth-child(3) select', JSON.stringify('Research'));
  assert.ok(await until(`document.querySelectorAll('[data-focused-thought]').length === 1`));
  assert.deepEqual(await ids(), ['unicode'], 'remapped thought obeys current theme');

  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click('.focused-find-form button'); await words('no such synthetic sentence');
  await layout(); await screenshot('phone-empty-dark');
  await words('café 東');
  await layout(); await screenshot('phone-dark');
  await evaluate(`document.querySelector('.focused-find').style.fontSize='200%'`);
  await layout(); await screenshot('phone-200-text');
  const covered = await evaluate(`[...document.querySelectorAll('.focused-find-form input,.focused-find-form select,.focused-find-form button,.focused-find-top button')].flatMap(e=>{e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit && (hit===e || e.contains(hit)) ? [] : [e.outerHTML]})`);
  assert.deepEqual(covered, [], 'all form controls can be reached above the shell at 200% text');
  await evaluate(`document.querySelector('.focused-find-form button').scrollIntoView({block:'center',behavior:'instant'})`);
  await screenshot('phone-200-controls');
  await focus('.focused-find input'); await key('Escape', 'Escape', 27);
  assert.ok(await until(`!document.querySelector('.focused-find')`));
  assert.ok(await until(`document.activeElement?.dataset.guide === 'catalog'`), 'Escape returns focus to Features');
  await show(); await click('.focused-find-top button');
  assert.ok(await until(`document.activeElement?.dataset.guide === 'catalog'`), 'Close returns focus');
  await show(); await catalog();
  await click('[data-row="focused-find"] [role=switch]');
  assert.ok(await until(`!document.querySelector('[data-brick="focused-find"]')`), 'disable unmounts view');
  await key('Escape', 'Escape', 27);
  assert.ok(await until(`!!document.querySelector('.spine-ready')`), 'disable restores baseline');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 15000));
  await catalog();
  assert.equal(await evaluate(`document.querySelector('[data-row="focused-find"] [role=switch]').getAttribute('aria-checked')`), 'false', 'disabled switch persists');
  await key('Escape', 'Escape', 27);
  await focus('input[type=search]'); await page('Input.insertText', { text: 'Amber' });
  assert.ok(await until(`!!document.querySelector('.shell-find-row')`), 'global Find still works');
  await key('Enter', 'Enter', 13);
  assert.ok(await until(`!!document.querySelector('.spine-ready')`));
  assert.deepEqual(core.heard.filter(m => m.type === 'email'), Array.from({ length: connections }, () => ({ type: 'email', on: true })), 'only the existing email capability handshake, once per connection');
  const disabledCapability = m => ['partner','voice_shortcuts','reply_format'].includes(m.type) && m.on === false && Object.keys(m).length === 2;
  assert.deepEqual(core.heard.filter(m => !['email','heartbeat','this','read','focus','cancel_find','attention'].includes(m.type) && !disabledCapability(m)), [], 'no model, connector, mutation, microphone or enabled feature requests');

  // An empty map is a real enabled view too, not just a playground rendering.
  world = { ...world, threads: [], thoughts: [], topics: {}, active: null, active_by: {} };
  core.send({ type: 'snapshot', world });
  await catalog(); await click('[data-row="focused-find"] [role=switch]');
  await click('[data-row="focused-find"] .shell-link');
  assert.ok(await until(`document.querySelector('.focused-find-status')?.textContent === 'Choose a filter or type words'`));
  await words('empty'); assert.equal(await evaluate(`document.querySelector('.focused-find-status').textContent`), 'No matching thoughts');
  await layout(); await screenshot('phone-empty-map');
  assert.deepEqual(requests.filter(url => !url.startsWith(`http://127.0.0.1:${core.port}/`) && !url.startsWith(`ws://127.0.0.1:${core.port}/`) && !url.startsWith('data:')), [], 'no external network requests');
  assert.deepEqual(await evaluate('window.__findErrors ?? []'), [], 'no browser errors');
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/bricks.html?brick=focused-find&sample=student-week` });
  assert.ok(await until(`!!document.querySelector('.focused-find select option:nth-child(2)')`,15000));
  const firstSpeaker = await evaluate(`document.querySelector('.focused-find select option:nth-child(2)').value`);
  await field('.focused-find select', firstSpeaker);
  assert.ok(await until(`!!document.querySelector('[data-focused-thought]')`));
  const firstSource = await evaluate(`({id:document.querySelector('[data-focused-thought]').dataset.focusedThought,text:document.querySelector('.focused-find-original p').textContent})`);
  await click('.focused-find-result button');
  assert.ok(await until(`document.querySelector('[data-original-thought]')?.dataset.originalThought === ${JSON.stringify(firstSource.id)}`), 'playground opens the exact source');
  assert.equal(await evaluate(`document.querySelector('[data-original-thought] blockquote').textContent`), firstSource.text);
  console.log('PASS f7-find: gate/persistence/cleanup, intersection, exact navigation, Unicode, 50/100/120, live updates, empty/narrow/keyboard/dark/reduced-motion/200%');
  console.log(`Synthetic screenshots: ${shots}`);
} finally { await scene?.close(); core.close(); }
