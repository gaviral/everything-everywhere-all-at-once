// Synthetic, isolated real-core/card check. Leaves screenshots and receipts in OS temp; no credentials or device input.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPage, ready, sleep, standInCore } from './headless.mjs';
import { uiServer } from './ui-server.mjs';
import { decodeEventLog } from './event-log-fixture.mjs';

// This acceptance command always runs page checks, even when a broader precheck disables them.
process.env.PRECHECK_PAGES = '1';
for (const key of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|AUTH/i.test(key)) delete process.env[key];
assert.equal(ready(), '', 'built UI and installed Chrome required');
const root = new URL('..', import.meta.url).pathname;
// Cargo is a child of this already-leased check. Preserve only its resource lease metadata;
// provider configuration stays excluded, and the fixture core below still receives an explicit whitelist.
const leaseKeys = new Set(["E2A2O_LEASES", "E2A2O_RESOURCES", "E2A2O_LIMIT_HEAVY", "E2A2O_HEAVY_CLASS"]);
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => leaseKeys.has(key) || !/KEY|TOKEN|SECRET|CREDENTIAL|AUTH|^USAGE_FILE$|^ROOM_|^PUBLIC_URL$|^E2A2O_/i.test(key)));
const rust = spawnSync('cargo', ['test', '--quiet', '--manifest-path', 'core/Cargo.toml', 'f7_questions'], { cwd: root, env: clean, encoding: 'utf8' });
assert.equal(rust.status, 0, `f7_questions Rust tests: ${rust.stderr}\n${rust.stdout}`);
assert.match(rust.stdout, /3 passed/, 'all three focused Rust tests actually ran');
const dir = mkdtempSync(join(tmpdir(), 'e2a2o-f7-questions-'));
const data = join(dir, 'map'); mkdirSync(data);
const journal = join(data, 'journal.jsonl');
const legacy = [
  { type: 'apps_seeded' },
  { type: 'thread_added', thread: { id: 'T-synthetic', title: 'Trail planning', parent_id: null, status: 'open', last_point: 'Check the trail', touched_ms: 1, tags: [] } },
  { type: 'thought_added', thought: { id: 'thought-synthetic', speaker: 'you', text: 'Check the trail', point: 'Check the trail', thread_id: 'T-synthetic', placed: true, unclear: '', at_ms: 1, place_ms: 0 } },
  { type: 'active_changed', thread_id: 'T-synthetic', speaker: 'you' },
];
writeFileSync(journal, legacy.map(c => JSON.stringify(c)).join('\n') + '\n');
const portProbe = createServer();
await new Promise(r => portProbe.listen(0, '127.0.0.1', r));
const port = portProbe.address().port;
await new Promise(r => portProbe.close(r));
assert.ok(![4360, 4399].includes(port));
const url = `http://127.0.0.1:${port}`;
const binary = join(process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'core/target'), 'debug/e2a2o-core');
let child, browser, fixture;
async function stopCore() {
  if (!child) return;
  const own = child; child = null;
  if (own.exitCode === null && own.signalCode === null) {
    const exit = new Promise(r => own.once('exit', r)); own.kill('SIGTERM');
    await Promise.race([exit, sleep(3000)]);
    if (own.exitCode === null && own.signalCode === null) { own.kill('SIGKILL'); await exit; }
  }
  own.stderr.destroy(); own.unref();
}
async function startCore() {
  let errors = '';
  // A whitelist means no provider credentials/configuration can reach the core, even through an alternate name.
  child = spawn(binary, [], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], env: {
    PATH: process.env.PATH, LANG: 'en_US.UTF-8', PORT: String(port), E2A2O_DATA: data, E2A2O_UI: join(root, 'ui/dist'),
    MODEL_API_KEY: '', USAGE_FILE: '', ROOM_CODE: '', PUBLIC_URL: '', E2A2O_HOSTED: '0', E2A2O_TRACE: '', PRESET: 'demo', PICTURES: 'off', RUST_LOG: 'error',
  } });
  child.stderr.on('data', d => { errors = (errors + d).slice(-2000); });
  for (let n = 0; n < 300; n++) {
    assert.equal(child.exitCode, null, `core exited: ${errors}`);
    if (await fetch(`${url}/room`).then(r => r.ok).catch(() => false)) return;
    await sleep(50);
  }
  throw Error(`core startup timed out: ${errors}`);
}
const card = '.saved-questions';
const sw = '[role="switch"][aria-label="Saved questions"]';
const visible = selector => `!!document.querySelector(${JSON.stringify(selector)})`;
async function wait(expression, why) { assert.ok(await browser.until(expression, 10000), why); }
async function click(selector) { await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function button(text, parent = card) {
  await browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(parent + ' button')})].find(b => b.textContent === ${JSON.stringify(text)}).click()`);
}
async function key(key, code, num) {
  for (const type of ['keyDown', 'keyUp']) await browser.page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: num, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) });
}
async function type(selector, text) {
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await browser.page('Input.insertText', { text });
}
async function features() {
  await browser.evaluate(`[...document.querySelectorAll('[data-slot="top-right"] button')].find(b => b.textContent.includes('Features')).click()`);
  await wait(visible(sw), 'Features lists Saved questions');
}
async function toggle() {
  await browser.evaluate(`document.querySelector(${JSON.stringify(sw)}).focus()`);
  await key(' ', 'Space', 32);
}
async function closeFeatures() { await click('.shell-rail-close'); }
async function openCard() {
  await wait(visible(card), 'card mounts');
  await browser.evaluate(`document.querySelector('${card} > button').focus()`);
  await key('Enter', 'Enter', 13);
  await wait(visible('.saved-questions-body'), 'keyboard opens card');
}
const changes = () => decodeEventLog(readFileSync(journal, 'utf8'));
const questions = () => { const m = new Map(); for (const c of changes()) if (c.type === 'question_saved') m.set(c.question.id, c.question); return [...m.values()]; };
async function saved(revision) {
  await wait(`document.querySelector('${card} [role="status"]')?.textContent === 'Saved' && document.querySelector('[data-revision="${revision}"]') !== null`, `Saved only after revision ${revision} acknowledgement and world`);
}
async function screenshot(name) {
  await browser.evaluate('document.fonts.ready');
  const { data: png } = await browser.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(png, 'base64'));
}
async function layout(width, height, dark, large, name) {
  await browser.page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 720 });
  await browser.page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.evaluate(`document.documentElement.style.fontSize = ${JSON.stringify(large ? '32px' : '')}`);
  await sleep(150);
  const bounds = await browser.evaluate(`(() => { const c = document.querySelector('${card}'), r = c.getBoundingClientRect(), body = c.querySelector('.saved-questions-body'); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, clipped:body.scrollWidth > body.clientWidth + 1, page:document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.top >= 0 && bounds.bottom <= height, `${name}: card remains on screen ${JSON.stringify(bounds)}`);
  assert.equal(bounds.clipped, false, `${name}: no horizontal clipping`);
  assert.equal(bounds.page, false, `${name}: page has no horizontal overflow`);
  for (const selector of [`${card} textarea`, `${card} button[type="submit"]`]) {
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'}); document.querySelector(${JSON.stringify(selector)}).focus()`);
    assert.ok(await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}), r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && e===document.activeElement; })()`), `${name}: essential control reachable in scroll area`);
  }
  if (large) {
    await screenshot(`${name}-input`);
    for (const label of ['Answer', 'Archive']) {
      const present = await browser.evaluate(`[...document.querySelectorAll('${card} button')].some(b => b.textContent === ${JSON.stringify(label)})`);
      if (present) {
        assert.ok(await browser.evaluate(`(() => { const e=[...document.querySelectorAll('${card} button')].find(b => b.textContent === ${JSON.stringify(label)}); e.scrollIntoView({block:'nearest'}); e.focus(); const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`), `${name}: ${label} is reachable at 200% text`);
      }
    }
    if (await browser.evaluate(`!!document.querySelector('.saved-questions-row')`)) await screenshot(`${name}-row-controls`);
  }
  await browser.evaluate(`document.querySelector('.saved-questions-body').scrollTop = 0`);
  await screenshot(name);
}
try {
  await startCore();
  browser = await openPage('about:blank');
  await browser.page('Page.enable');
  const requests = [];
  browser.on('Network.requestWillBeSent', ({ request }) => requests.push(request.url));
  await browser.page('Network.enable');
  await browser.page('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__sent=[];window.__received=[];window.__errors=[];
    addEventListener('error',e=>__errors.push(e.message));
    const Native=WebSocket;
    window.WebSocket=class extends Native { constructor(...args) {super(...args); window.__appSocket=this; this.addEventListener('message',e=>__received.push(JSON.parse(e.data)));} send(data) {if(typeof data==='string')__sent.push(JSON.parse(data));super.send(data);} };
  ` });
  await browser.page('Page.navigate', { url });
  await wait(`!!document.querySelector('#type-a-thought') && window.__received.some(m=>m.type==='snapshot')`, 'old journal loads through real socket');
  const baseline = readFileSync(journal, 'utf8');
  await sleep(300);
  assert.equal(await browser.evaluate(visible(card)), false, 'fresh browser has no feature UI');
  assert.deepEqual(await browser.evaluate(`__sent.filter(m=>m.type.includes('question') || m.type.includes('warm'))`), [], 'off sends no feature messages/warm requests');
  assert.deepEqual(await browser.evaluate(`__received.filter(m=>m.type.includes('question'))`), [], 'off receives no feature messages');
  assert.equal(requests.some(path => /saved-questions|warm/i.test(path)), false, 'off loads no feature or warm requests');
  assert.equal(readFileSync(journal, 'utf8'), baseline, 'off leaves legacy journal untouched');
  await type('#type-a-thought', 'Synthetic baseline draft');
  assert.equal(await browser.evaluate(`document.querySelector('#type-a-thought').value`), 'Synthetic baseline draft');
  await features(); await toggle();
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(sw)}).getAttribute('aria-checked')`), 'true');
  await closeFeatures();
  await browser.page('Page.reload'); await wait(visible(card), 'switch persists across reload');
  await features();
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(sw)}).getAttribute('aria-checked')`), 'true', 'persisted Features switch');
  await closeFeatures(); await openCard();
  assert.equal(readFileSync(journal, 'utf8'), baseline, 'enabling sends no mutations');
  await browser.evaluate(`document.querySelector('${card} textarea').focus()`);
  await key('Tab', 'Tab', 9);
  assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('${card} input[type="checkbox"]')`), true, 'native Tab reaches link checkbox');
  assert.equal(await browser.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'solid', 'keyboard focus is visible');
  await button('Save question');
  assert.ok(await browser.evaluate(`document.querySelector('${card}').textContent.includes('Question needs 1–280 characters.')`), 'invalid question refused visibly');
  assert.equal(questions().length, 0);
  assert.ok(await browser.evaluate(`document.querySelector('${card}').textContent.includes('No open questions yet.')`), 'honest empty state');
  assert.equal(await browser.evaluate(`document.querySelector('${card} input[type="checkbox"]').checked`), false, 'link initially unchecked');
  await layout(1440, 900, false, false, 'desktop-empty');
  await layout(390, 844, true, true, 'phone-empty-large');
  await layout(1440, 900, false, false, 'desktop-form');
  await type(`${card} textarea`, 'Which trail should we take?');
  await click(`${card} input[type="checkbox"]`);
  await button('Save question'); await saved(1);
  const original = questions()[0];
  assert.equal(original.thought_id, 'thought-synthetic'); assert.equal(original.owner, 'you'); assert.equal(questions().length, 1);
  // Idempotent create travels through the same live socket, without app-side retry machinery.
  const create = { type: 'save_question', id: original.id, text: original.question, thought_id: original.thought_id, answer: '', status: 'open', expected_revision: 0 };
  await browser.evaluate(`__appSocket.send(${JSON.stringify(JSON.stringify(create))})`);
  await wait(`__received.filter(m=>m.type==='question_result' && m.ok && m.revision===1).length === 2`, 'identical create acknowledged');
  assert.equal(changes().filter(c=>c.type==='question_saved').length, 1, 'duplicate create does not journal or duplicate');
  await button('Answer'); await wait(visible(`${card} textarea`), 'answer editor');
  assert.ok(await browser.until(`document.activeElement === [...document.querySelectorAll('${card} textarea')].at(-1)`), 'answer editor receives focus');
  await type(`${card} form:nth-of-type(2) label:last-of-type textarea`, 'Take the marked river trail.');
  await button('Save answer'); await saved(2);
  await screenshot('desktop-answered');
  const answer = questions()[0]; assert.equal(answer.status, 'answered'); assert.equal(answer.answer, 'Take the marked river trail.');
  await stopCore(); await wait(`document.querySelector('${card}').textContent.includes('Disconnected.')`, 'disconnected UI');
  const sentBefore = await browser.evaluate(`__sent.filter(m=>m.type==='save_question').length`);
  assert.equal(await browser.evaluate(`document.querySelector('${card} button[type="submit"]').disabled`), true, 'no disconnected request');
  await startCore(); await browser.page('Page.reload'); await openCard(); await button('Answered');
  await wait(`document.querySelector('[data-question-id="${original.id}"]')?.textContent.includes('Take the marked river trail.')`, 'same ID and answer recover after real core restart');
  assert.deepEqual(questions(), [answer], 'restart preserves one record exactly');
  assert.equal(await browser.evaluate(`__sent.filter(m=>m.type==='save_question').length`), 0, 'reconnect/reload never replays writes');
  assert.ok(sentBefore >= 3);
  // Stale write from the first speaker is refused; a second socket speaker cannot edit it.
  await browser.evaluate(`window.__other=[];window.__otherSocket=new WebSocket(${JSON.stringify(url.replace('http:', 'ws:') + '/ws?name=Other')});__otherSocket.addEventListener('message',e=>__other.push(JSON.parse(e.data)));`);
  await wait(`__other.some(m=>m.type==='snapshot')`, 'second speaker connected');
  // The instrumentation records the latest socket, so target the first socket explicitly below.
  await browser.evaluate(`window.__ownerSocket = null`);
  // Send using a new explicit same-owner socket; server authority remains the socket speaker.
  await browser.evaluate(`window.__owner=[];window.__ownerSocket=new WebSocket(${JSON.stringify(url.replace('http:', 'ws:') + '/ws')});__ownerSocket.addEventListener('message',e=>__owner.push(JSON.parse(e.data)));`);
  await wait(`__owner.some(m=>m.type==='snapshot')`, 'owner probe connected');
  const edit = { ...create, answer: 'Overwrite must fail.', status: 'answered', expected_revision: 1 };
  await browser.evaluate(`__ownerSocket.send(${JSON.stringify(JSON.stringify(edit))})`);
  await wait(`__owner.some(m=>m.type==='question_result' && !m.ok)`, 'stale revision refused');
  assert.equal(await browser.evaluate(`__other.some(m=>m.type==='question_result')`), false, 'result not broadcast to other speaker');
  await browser.evaluate(`__otherSocket.send(${JSON.stringify(JSON.stringify({ ...edit, expected_revision: 2 }))})`);
  await wait(`__other.some(m=>m.type==='question_result' && !m.ok && m.error.includes('Only the person'))`, 'other speaker refused');
  assert.deepEqual(questions(), [answer], 'refusals do not change persisted record');
  await browser.evaluate(`__ownerSocket.close();__otherSocket.close()`);
  await button('Reopen'); await saved(3); assert.equal(questions()[0].answer, answer.answer, 'reopen preserves answer');
  // Removal of the source preserves the question/answer and makes the source label honest.
  await browser.evaluate(`window.__deleteSocket=new WebSocket(${JSON.stringify(url.replace('http:', 'ws:') + '/ws')});__deleteSocket.onopen=()=>__deleteSocket.send(JSON.stringify({type:'delete',thought_id:'thought-synthetic'}))`);
  await wait(`document.querySelector('${card}').textContent.includes('Source no longer on map')`, 'missing source shown');
  await browser.evaluate(`__deleteSocket.close()`);
  await layout(390, 844, false, false, 'phone-open');
  await layout(390, 844, true, true, 'phone-open-large');
  await layout(1440, 900, true, false, 'desktop-dark');
  await button('Archive'); await wait(`document.querySelector('${card} [role="status"]').textContent==='Saved' && document.querySelector('${card} summary').textContent.includes('(1)')`, 'archived acknowledgement');
  assert.equal(questions()[0].status, 'archived'); assert.equal(questions()[0].revision, 4);
  await click(`${card} summary`); await button('Reopen'); await saved(5);
  await button('Answer');
  // The editor holds its observed revision even when another window changes the record.
  const concurrent = { ...create, answer: 'Use the signed route.', status: 'answered', expected_revision: 5 };
  await browser.evaluate(`window.__editSocket=new WebSocket(${JSON.stringify(url.replace('http:', 'ws:') + '/ws')});__editSocket.onopen=()=>__editSocket.send(${JSON.stringify(JSON.stringify(concurrent))})`);
  await wait(`__received.some(m=>m.type==='change' && m.change.type==='question_saved' && m.change.question.revision===6)`, 'concurrent edit reaches UI');
  await button('Save answer');
  await wait(`document.querySelector('${card}').textContent.includes('Question changed. Review the current record')`, 'stale editor refusal is visible');
  assert.equal(questions()[0].revision, 6); assert.equal(questions()[0].answer, concurrent.answer);
  const refusedWrites = await browser.evaluate(`__sent.filter(m=>m.type==='save_question').length`);
  await sleep(200);
  assert.equal(await browser.evaluate(`__sent.filter(m=>m.type==='save_question').length`), refusedWrites, 'stale edit is not automatically replayed');
  await button('Review current record'); await button('Save answer'); await saved(7);
  await browser.evaluate(`__editSocket.close()`);
  await browser.evaluate(`document.querySelector('${card} textarea').focus()`); await key('Escape', 'Escape', 27);
  assert.equal(await browser.evaluate(visible('.saved-questions-body')), false, 'Escape closes');
  assert.equal(await browser.until(`document.activeElement===document.querySelector('${card} > button')`), true, 'focus returns to opener');
  const beforeOff = readFileSync(journal, 'utf8');
  const sendsOff = await browser.evaluate(`__sent.filter(m=>m.type==='save_question').length`);
  await features(); await toggle(); await closeFeatures(); await wait(`!document.querySelector('${card}')`, 'disable unmounts UI');
  await type('#type-a-thought', 'Baseline typing still works');
  assert.equal(await browser.evaluate(`document.querySelector('#type-a-thought').value`), 'Baseline typing still works');
  await key('Escape', 'Escape', 27);
  await sleep(300);
  assert.equal(readFileSync(journal, 'utf8'), beforeOff, 'off does not delete or mutate records');
  assert.equal(await browser.evaluate(`__sent.filter(m=>m.type==='save_question').length`), sendsOff, 'off sends nothing');
  assert.deepEqual((await browser.evaluate('__errors')).filter(error => !/^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications\.)$/.test(error)), [], 'no browser errors');
  await browser.close(); browser = null; await stopCore();

  // Lost acknowledgement: exercise real enabled card against existing transport helper; reconnect never resends.
  let joined = true;
  fixture = await standInCore(() => joined ? [{ type: 'snapshot', world: { threads: [], thoughts: [], active: null, active_by: {}, questions: [] } }] : null);
  browser = await openPage(`http://127.0.0.1:${fixture.port}`);
  await wait(`!!document.querySelector('#type-a-thought')`, 'fixture empty app ready');
  await features(); await toggle(); await closeFeatures(); await openCard();
  await type(`${card} textarea`, 'What remains unfinished?'); await button('Save question');
  await wait(`document.querySelector('${card} [role="status"]').textContent==='Saving…'`, 'queue is not Saved');
  const firstWrites = fixture.heard.filter(m=>m.type==='save_question').length; assert.equal(firstWrites, 1);
  joined = false; fixture.drop();
  await wait(`document.querySelector('${card}').textContent.includes('Disconnected before confirmation')`, 'lost ack visible');
  joined = true;
  await wait(`!document.querySelector('${card} button[type="submit"]').disabled`, 'reconnect enables explicit save');
  assert.equal(fixture.heard.filter(m=>m.type==='save_question').length, 1, 'uncertain write never automatically retried');
  await screenshot('empty-unconfirmed');
  await browser.close(); browser = null; fixture.close(); fixture = null;
  globalThis.location = new URL('http://localhost/');
  const server = await uiServer();
  try {
    const { snapshotOf } = await server.ssrLoadModule('/src/bricks-core.ts');
    const own = questions()[0];
    const world = { threads: [], thoughts: [], active: null, active_by: {}, questions: [own, { ...own, id: 'other', owner: 'Other' }], suggestions: [], actions: [], apps: [] };
    assert.deepEqual(snapshotOf(world, 'you', true, new Map(), '').questions, [own], 'contract filters by map.me');
  } finally { await server.close(); }
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ ok: true, rustTests: 3, questionId: questions()[0].id, revision: 7, screenshots: ['desktop-empty','desktop-answered','phone-open','phone-open-large','phone-open-large-input','phone-open-large-row-controls','desktop-dark','empty-unconfirmed'] }, null, 2));
  console.log(`f7-questions-check: ok (Rust, real UI/socket, legacy, gate, persistence/restart, revisions, ownership, source removal, layouts, keyboard, lost ack); screenshots: ${dir}`);
} finally {
  if (browser) await browser.close();
  fixture?.close(); await stopCore();
}
