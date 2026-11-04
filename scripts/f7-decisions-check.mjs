// Real opt-in UI, synthetic transport/state only. No app data or provider process is opened.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCore, empty } from './capture-fixture.mjs';
import { openPage, ready, sleep } from './headless.mjs';

// Chrome is the only spawned process. It inherits no provider credentials.
for (const name of Object.keys(process.env)) if (/(?:KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i.test(name)) delete process.env[name];
assert.equal(ready(), '', 'built UI and installed Chrome are required');
const shots = mkdtempSync(join(tmpdir(), 'f7-decisions-'));
const epoch = Date.UTC(2026, 0, 12, 12);
const topic = (id, title, parent_id = null) => ({ id, title, parent_id, status: 'open', last_point: '', touched_ms: epoch, tags: [], picture: null, dropped_by: '' });
const thought = (id, thread_id, speaker, at, decided, point, text = point) => ({ id, thread_id, speaker, at_ms: epoch + at, decided, point, text, placed: true, complete: true, unclear: '', place_ms: null });
const older = thought('older', 'details', 'Rin', 1000, true, 'Use the blue cover', 'Decided: use the blue cover. Keep the title in full.');
const newer = thought('newer', 'printing', 'Helper', 2000, true, 'Print twelve copies', 'Let’s go with twelve copies for the table.');
const suggestion = thought('suggestion', 'details', 'Rin', 3000, false, 'A possible title', 'We have not decided the title; this is only a suggestion.');
const seed = { ...empty(), threads: [topic('cover', 'Cover'), topic('details', 'Cover details', 'cover'), topic('printing', 'Printing')],
  thoughts: [older, newer, suggestion], active: 'printing', active_by: { you: 'printing' }, ai: ['Helper'],
  suggestions: [{ id: 'candidate', thread_id: 'printing', text: 'We decided maybe try a poster', status: 'new' }] };
const core = await captureCore({ key: false, seed });
assert.ok(![4360, 4399].includes(core.port), 'ephemeral fixture port');
let browser;
const errors = [], requests = [], frames = [];
try {
  browser = await openPage('about:blank');
  const { page, evaluate, until } = browser;
  const origin = `http://127.0.0.1:${core.port}`;
  await page('Page.enable');
  await page('Network.enable');
  browser.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
  await page('Runtime.enable');
  browser.on('Network.requestWillBeSent', e => requests.push(e.request.url));
  browser.on('Network.webSocketFrameSent', e => { try { frames.push(JSON.parse(e.response.payloadData)); } catch { /* binary */ } });
  // Fail external network attempts, while retaining their URLs as assertion evidence.
  browser.on('Fetch.requestPaused', e => { void page(e.request.url.startsWith(origin + '/') ? 'Fetch.continueRequest' : 'Fetch.failRequest',
    e.request.url.startsWith(origin + '/') ? { requestId: e.requestId } : { requestId: e.requestId, errorReason: 'BlockedByClient' }); });
  await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] });
  await page('Page.navigate', { url: origin + '/' });
  assert.ok(await until('!!document.querySelector("#type-a-thought") && !!document.querySelector("[data-brick=spine]")', 12000), 'real default app mounts');
  const key = async (name, code = name, n = name === 'Enter' ? 13 : name === 'Escape' ? 27 : name === 'Tab' ? 9 : 32) => {
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: n,
      ...(name === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
  };
  const click = async selector => {
    assert.ok(await until(`!!document.querySelector(${JSON.stringify(selector)})`), `exists: ${selector}`);
    const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...r, button: 'left', clickCount: 1 });
  };
  const rows = () => evaluate('[...document.querySelectorAll("[data-decision]")].map(e => e.dataset.decision)');
  const features = async () => {
    if (!await evaluate('!!document.querySelector(".shell-catalog")')) await click('[data-guide="catalog"]');
    assert.ok(await until('!!document.querySelector("[data-row=decisions]")'), 'Decisions has a Features row');
  };
  const show = async () => {
    await features();
    await click('[data-row="decisions"] .shell-link');
    assert.ok(await until('!!document.querySelector(".decisions") && !document.querySelector(".shell-rail")'), 'Show opens real view, closes rail');
  };
  const screenshot = async name => {
    await evaluate('document.fonts.ready.then(() => true)');
    const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(shots, name + '.png'), Buffer.from(data, 'base64'));
  };
  const layout = async () => {
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
    assert.equal(await evaluate(`(() => {const e=document.querySelector('#type-a-thought'), r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()`), true, 'input remains wholly on screen');
    for (const selector of ['.decisions-filters', '.decisions-row', '.decisions button', '.decisions summary']) assert.equal(await evaluate(`([...document.querySelectorAll(${JSON.stringify(selector)})]).every(e=>{const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth})`), true, `${selector} stays in width`);
  };
  // Fresh storage must never mount/load this feature or send its own work.
  assert.equal(await evaluate('localStorage.getItem("e2a2o.bricks")'), null, 'fresh storage');
  assert.deepEqual(await rows(), []);
  assert.equal(await evaluate('!!document.querySelector("[data-brick=decisions]")'), false);
  assert.equal(requests.some(url => /decisions/i.test(url)), false, 'no feature code or warm request before opt-in');
  assert.equal(frames.some(m => JSON.stringify(m).includes('decisions')), false, 'no feature-specific message before opt-in');
  await features();
  assert.equal(await evaluate('document.querySelector("[aria-label=Decisions]").getAttribute("aria-checked")'), 'false');
  await evaluate('document.querySelector("[role=switch][aria-label=Decisions]").focus()');
  await key(' ', 'Space');
  assert.ok(await until('document.querySelector("[role=switch][aria-label=Decisions]")?.getAttribute("aria-checked") === "true"'), 'Space enables through Features');
  assert.equal(await evaluate('!!document.querySelector(".decisions")'), false, 'enable alone does not change current view');
  await page('Page.reload');
  assert.ok(await until('!!document.querySelector("#type-a-thought")'));
  await features();
  assert.equal(await evaluate('document.querySelector("[role=switch][aria-label=Decisions]").getAttribute("aria-checked")'), 'true', 'switch persists on reload');
  await key('Escape');
  await evaluate('document.querySelector(".shell-find input").focus()');
  await page('Input.insertText', { text: 'cover' });
  assert.ok(await until('document.querySelector(".shell-find input")?.value === "cover"'), 'Find has a query before opening Decisions');
  await show();
  assert.deepEqual(await rows(), ['newer', 'older'], 'only two recorded decisions in newest-first order');
  assert.equal(await evaluate('document.activeElement.id'), 'decisions-heading', 'view receives keyboard focus');
  assert.equal(await evaluate('document.querySelector("[data-decision=newer] .decisions-meta").textContent.includes("Helper · AI")'), true, 'AI identity comes from speakers');
  assert.equal(await evaluate('document.querySelector("[data-decision=older] .decisions-meta").textContent.includes("Rin")'), true, 'person attribution');
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.textContent'), 'All', 'Tab reaches native filter');
  assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none', 'visible keyboard focus');
  await key('Tab'); await key('Enter');
  assert.deepEqual(await rows(), ['newer'], 'This topic snapshots Printing');
  core.send({ type: 'change', change: { type: 'active_changed', thread_id: 'details', speaker: 'you' } });
  assert.ok(await until('document.querySelector(".decisions-scope")?.textContent.includes("Printing")'));
  assert.deepEqual(await rows(), ['newer'], 'active topic updates cannot change captured filter');
  await click('.decisions-filters button:first-child');
  await evaluate('document.querySelector("[data-decision=older] summary").focus()');
  await key('Enter');
  assert.equal(await evaluate('document.querySelector("[data-decision=older] details").open'), true, 'keyboard opens Original words');
  assert.equal(await evaluate('document.querySelector("[data-decision=older] details p").textContent'), older.text);
  await click('[data-decision=newer] summary');
  assert.equal(await evaluate('document.querySelector("[data-decision=newer] details p").textContent'), newer.text);
  await layout(); await screenshot('desktop-light');
  // Keep a draft, open an older decision with a newer nondecision in the same nested topic.
  await evaluate('document.querySelector("#type-a-thought").focus()');
  await page('Input.insertText', { text: 'A draft kept while browsing' });
  await evaluate(`(() => {let f=document.querySelector('.decisions')[Object.keys(document.querySelector('.decisions')).find(k=>k.startsWith('__reactFiber'))]; while(f && !f.memoizedProps?.actions) f=f.return; window.decisionActions=f.memoizedProps.actions;})()`);
  await click('[data-decision=older] .decisions-open');
  assert.ok(await until('!!document.querySelector("[data-brick=spine]")'));
  assert.ok(await until('!!document.querySelector(".spine-cut[data-thought=older]")', 10000), 'visible highlight names older thought, not latest nondecision');
  const destination = await evaluate(`(() => {const e=document.querySelector('[data-brick=spine]'); let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber'))]; while(f && !f.memoizedProps?.host) f=f.return; return f.memoizedProps.host.destination;})()`);
  assert.equal(destination.thoughtId, 'older', 'host destination is exact ID');
  assert.equal(destination.threadId, 'details');
  assert.equal(await evaluate('document.querySelector(".shell-find input")?.value ?? ""'), '', 'explicit original jump clears Find');
  assert.equal(await evaluate('!!document.querySelector("[data-thought=older] .spine-words")'), true, 'nested original words are open');
  assert.equal(await evaluate('document.querySelector("#type-a-thought").value'), 'A draft kept while browsing');
  assert.ok(core.heard.some(m => m.type === 'focus' && m.thread_id === 'details'), 'explicit jump moves place');
  await show();
  await click('.decisions-filters button:last-child');
  assert.deepEqual(await rows(), ['older']);
  await click('[data-decision=older] .decisions-open');
  await show();
  assert.deepEqual(await rows(), ['older'], 'topic snapshot survives jump and return');
  await click('.decisions-filters button:first-child');
  // Live edits and decision flags, then actual source removal.
  core.send({ type: 'change', change: { type: 'thought_repointed', thought_id: 'older', point: 'Use the blue cover, with a white title' } });
  assert.ok(await until('document.querySelector("[data-decision=older] h2")?.textContent.includes("white title")'));
  core.send({ type: 'change', change: { type: 'thought_decided', thought_id: 'newer', decided: false } });
  assert.ok(await until('document.querySelectorAll("[data-decision]").length===1'), 'changed decision flag removes row');
  core.send({ type: 'change', change: { type: 'thought_skipped', thought_id: 'older' } });
  assert.ok(await until('document.querySelectorAll("[data-decision]").length===0'), 'removed source disappears');
  assert.equal(await evaluate('window.decisionActions.openThought("older")'), false, 'stale action refuses missing thought');
  assert.ok(await until('document.body.textContent.includes("Original thought is no longer on this map.")'), 'missing-source notice');
  // Fresh populated scene for narrow layouts, dark mode, enlarged text and equal-time order.
  core.state.world = structuredClone(seed);
  core.state.world.thoughts[1].at_ms = older.at_ms;
  core.send({ type: 'snapshot', world: core.state.world });
  assert.ok(await until('document.querySelectorAll("[data-decision]").length===2'));
  assert.deepEqual(await rows(), ['newer', 'older'], 'equal timestamps sort by id ascending');
  for (const [width, height, scheme] of [[1440, 900, 'dark'], [390, 844, 'light']]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await evaluate('scrollTo(0,0)'); await layout(); await screenshot(`${width === 390 ? 'phone' : 'desktop'}-${scheme}`);
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate('scrollTo(0,0)'); await sleep(150); await layout(); await screenshot('phone-dark');
  await evaluate('document.documentElement.style.fontSize="200%"');
  await layout(); await screenshot('phone-dark-200-text');
  await evaluate('document.documentElement.style.fontSize=""');
  // Empty map is a real enabled view, not a selector mirror or the welcome screen.
  core.state.world = empty(); core.send({ type: 'snapshot', world: core.state.world });
  assert.ok(await until('document.querySelector(".decisions-empty")?.textContent === "No decisions recorded yet."'));
  await layout(); await screenshot('phone-empty');
  await key('Escape');
  assert.ok(await until('!document.querySelector(".decisions")'), 'Escape closes view on empty map');
  assert.ok(await until('document.activeElement.dataset.guide === "catalog"'), 'focus returns to Features');
  await show();
  await click('[data-slot=bottom-left] button');
  assert.ok(await until('!document.querySelector(".decisions")'), 'Close works');
  assert.ok(await until('document.activeElement.dataset.guide === "catalog"'), 'Close returns focus to Features');
  core.state.world = structuredClone(seed); core.send({ type: 'snapshot', world: core.state.world });
  await show(); await features();
  await click('[role=switch][aria-label=Decisions]');
  assert.ok(await until('!document.querySelector("[data-brick=decisions]") && document.documentElement.dataset.view === "map"'), 'disable uses existing view-off fallback');
  assert.equal(await evaluate('document.querySelector("[data-row=decisions] .shell-link") === null'), true, 'Show removed');
  await key('Escape');
  await evaluate('document.querySelector("#type-a-thought").focus()');
  await page('Input.insertText', { text: ' after disabling' });
  assert.equal(await evaluate('document.querySelector("#type-a-thought").value'), 'A draft kept while browsing after disabling', 'baseline composer unchanged');
  await key('Escape');
  assert.equal(await evaluate('!!document.querySelector(".decisions")'), false, 'no leftover feature key work');
  await page('Page.reload');
  assert.ok(await until('!!document.querySelector("[data-brick=spine]")'));
  await features();
  assert.equal(await evaluate('document.querySelector("[role=switch][aria-label=Decisions]").getAttribute("aria-checked")'), 'false', 'off persists');
  assert.equal(requests.some(url => !url.startsWith(origin + '/') && !url.startsWith('data:')), false, 'keyless view makes no external/provider request');
  const work = frames.filter(m => ['text', 'listen', 'position', 'annotate', 'sample'].includes(m.type) || (m.type === 'partner' && m.on));
  assert.deepEqual(work, [], 'enable/browse/disable causes no model, mic or map-writing work');
  assert.deepEqual(errors, [], 'no runtime exception');
  console.log(`f7-decisions-check: ok (opt-in, exact source jump, live updates, filters, keyboard, layouts, keyless); screenshots: ${shots}`);
} finally {
  await browser?.close(); core.close();
}
