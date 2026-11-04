// Synthetic state only. Mounts the real brick for refusals, then uses the built app and its Features switch.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { uiServer } from './ui-server.mjs';
import { openPage, ready, sleep } from './headless.mjs';
import { captureCore, capturePage, typeCapture } from './capture-fixture.mjs';

// Chrome is the only spawned process; it inherits no provider credentials.
for (const key of Object.keys(process.env)) if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete process.env[key];
assert.equal(ready(), '', 'built UI and installed Chrome are required');
const shots = mkdtempSync(join(tmpdir(), 'f7-starters-'));
const css = '.thinking-starters';
const fields = ['Should we try a shorter meeting?', 'Try twenty minutes\nKeep the current length', 'Leave time to prepare'];
const expected = 'Question:\nShould we try a shorter meeting?\n\nOptions:\nTry twenty minutes\nKeep the current length\n\nWhat matters:\nLeave time to prepare';
const labels = [['Question', 'Options', 'What matters'], ['Goal', 'What changed', 'Next step'], ['Trying to do', 'Stuck because', 'Small next move']];
const ids = ['choice', 'update', 'unblock'];
const q = JSON.stringify;
async function key(browser, key, code = key, windowsVirtualKeyCode) {
  for (const type of ['keyDown', 'keyUp']) await browser.page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
}
async function click(browser, text, root = css) {
  assert.ok(await browser.evaluate(`(() => {const b=[...document.querySelectorAll(${q(root + ' button')})].find(b=>b.textContent===${q(text)}); if(!b || b.disabled) return false; b.focus();return true;})()`), `focus ${text}`);
  await key(browser, 'Enter', 'Enter', 13);
  await sleep(30);
}
async function choose(browser, id) {
  await browser.evaluate(`(()=>{const s=document.querySelector('#thinking-starters-select');s.focus();s.value=${q(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(30);
}
async function fill(browser, index, text) {
  await browser.evaluate(`document.querySelector('#thinking-starters-field-${index}').focus()`);
  // Use React's native textarea setter for deterministic replacement, including over-limit paste coverage.
  await browser.evaluate(`(()=>{const t=document.querySelector('#thinking-starters-field-${index}');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${q(text)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(30);
}
async function values(browser) { return browser.evaluate(`Array.from(document.querySelectorAll('${css} textarea'),t=>t.value)`); }
async function open(browser) {
  await click(browser, 'Thinking starters');
  assert.ok(await browser.until(`!!document.querySelector('#thinking-starters-select')`));
}
async function geometry(browser, width, height) {
  const g = await browser.evaluate(`(() => {
    const r=document.querySelector('${css}').getBoundingClientRect(), c=document.querySelector('#type-a-thought').getBoundingClientRect();
    const body=document.querySelector('.thinking-starters-body');
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,composer:c.top,composerBottom:c.bottom,clear:r.right<=c.left||r.left>=c.right||r.bottom<=c.top||r.top>=c.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,
      scrollable:body.scrollHeight>body.clientHeight, horizontal:body.scrollWidth>body.clientWidth+1};
  })()`);
  assert.ok(g.left >= 0 && g.right <= width + 1 && g.top >= 0 && g.clear && g.composerBottom <= height, `card and input fit ${width}: ${q(g)}`);
  assert.equal(g.overflow || g.horizontal, false, 'no horizontal crop');
}
async function focusedControlVisible(browser) {
  return browser.evaluate(`(() => {
    const r=document.activeElement.getBoundingClientRect();
    const clips=['.thinking-starters-body','.thinking-starters','.shell-cards'].map(s=>document.querySelector(s).getBoundingClientRect());
    return clips.every(b=>r.top>=b.top&&r.bottom<=b.bottom+1&&r.left>=b.left&&r.right<=b.right+1);
  })()`);
}
async function screenshot(browser, file) {
  const { data } = await browser.page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, file), Buffer.from(data, 'base64'));
}
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return [4360, 4399].includes(port) ? freePort() : port;
}

// No test-only behavior ships in the brick. This temporary route imports its real component.
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div>
<script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import ThinkingStarters from '/src/bricks/thinking-starters/index.tsx';
window.calls=[];
const actions={addThought(text){window.calls.push(text);return window.calls.length>1;}};
createRoot(document.getElementById('root')).render(React.createElement(ThinkingStarters,{actions}));
</script></body></html>`;
let fixture, browser;
try {
  fixture = await uiServer({ envDir: false, plugins: [{ name: 'f7-starters-fixture', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__f7-test') return next();
      try { res.setHeader('content-type', 'text/html'); res.end(await server.transformIndexHtml(req.url, fixtureHtml)); }
      catch (error) { next(error); }
    });
  } }] }, { port: await freePort() });
  const rules = await fixture.ssrLoadModule('/src/bricks/thinking-starters/rules.ts');
  assert.equal(rules.serialize(labels[0], fields), expected);
  assert.equal(rules.canPreview(labels[0], ['', 'a', 'b']), false);
  assert.equal(rules.canPreview(labels[0], ['a', '', '']), false);
  assert.equal(rules.canPreview(labels[0], ['a', ' ', 'b']), true);
  assert.equal(rules.canPreview(labels[0], ['a'.repeat(1001), 'b', '']), false);
  assert.ok(rules.serialize(labels[2], ['x'.repeat(1000), 'x'.repeat(1000), 'x'.repeat(1000)]).length <= 4000);
  await fixture.listen();
  browser = await openPage(`http://127.0.0.1:${fixture.httpServer.address().port}/__f7-test`);
  assert.ok(await browser.until(`!!document.querySelector('${css}')`, 15000), 'real component mounted in action fixture');
  await open(browser);
  for (let i = 0; i < 3; i++) await fill(browser, i, fields[i]);
  await click(browser, 'Preview');
  assert.equal(await browser.evaluate(`document.querySelector('.thinking-starters-preview').textContent`), expected);
  await browser.evaluate(`{const b=[...document.querySelectorAll('${css} button')].find(b=>b.textContent==='Send as thought'); b.click();b.click();}`);
  assert.ok(await browser.until(`document.querySelector('.thinking-starters-status')?.textContent.startsWith('Not submitted')`));
  assert.deepEqual(await browser.evaluate('window.calls'), [expected], 'synchronous double click calls host once on refusal');
  await click(browser, 'Edit fields');
  assert.deepEqual(await values(browser), fields, 'refusal retains all fields');
  await click(browser, 'Preview');
  // First refusal already exercised; exercise the real Retry control with another explicit false answer.
  await browser.evaluate(`window.calls=[]`);
  await click(browser, 'Send as thought');
  await browser.evaluate(`{const b=[...document.querySelectorAll('${css} button')].find(b=>b.textContent==='Retry'); b.click(); b.click();}`);
  assert.ok(await browser.until(`document.querySelector('.thinking-starters-status')?.textContent==='Submitted to E2A2O'`));
  assert.deepEqual(await browser.evaluate('window.calls'), [expected, expected], 'one refused attempt then exactly one successful Retry despite double click');
  assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('${css} button')).some(b=>b.textContent==='Send as thought'||b.textContent==='Retry')`), false);
  console.log('f7-starters: actual component refusal, retained fields, Retry and synchronous send guard ok');
} finally { await browser?.close(); await fixture?.close(); }

const core = await captureCore({ key: false });
browser = null;
try {
  assert.ok(![4360, 4399].includes(core.port));
  browser = await capturePage(core);
  const { evaluate, until, page } = browser;
  const requests = [], errors = [];
  browser.on('Network.requestWillBeSent', event => requests.push(event.request.url));
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await page('Network.enable'); await page('Runtime.enable');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('#type-a-thought')`));
  await evaluate('document.fonts.ready.then(() => true)');
  assert.equal(await evaluate(`localStorage.getItem('e2a2o.bricks')`), null, 'fresh storage');
  assert.equal(await evaluate(`document.querySelector('${css}')`), null, 'off means no feature UI');
  assert.equal(core.heard.some(m => JSON.stringify(m).includes('thinking-starters')), false, 'off means no feature message');
  assert.equal(requests.some(url => /thinking-starters|warm/i.test(url)), false, 'off means no feature load or warm request');
  const baselineWorld = JSON.stringify(core.state.world);
  const showFeatures = async () => {
    await evaluate('document.activeElement?.blur()');
    await key(browser, 'c', 'KeyC', 67);
    assert.ok(await until(`!!document.querySelector('[data-row="thinking-starters"] [role="switch"]')`), 'Features opens by keyboard');
  };
  const toggle = async expected => {
    await evaluate(`document.querySelector('[data-row="thinking-starters"] [role="switch"]').focus()`);
    await key(browser, ' ', 'Space', 32);
    assert.ok(await until(`document.querySelector('[data-row="thinking-starters"] [role="switch"]').getAttribute('aria-checked')==='${expected}'`), 'native switch by keyboard');
    await key(browser, 'Escape', 'Escape', 27);
  };
  await showFeatures(); await toggle('true');
  assert.ok(await until(`!!document.querySelector('${css}')`), 'enabled real app brick');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('${css}')`), 'switch persists after reload');
  await showFeatures();
  assert.equal(await evaluate(`document.querySelector('[data-row="thinking-starters"] [role="switch"]').getAttribute('aria-checked')`), 'true');
  await key(browser, 'Escape', 'Escape', 27);
  await evaluate(`document.querySelector('${css} button').focus()`);
  await key(browser, 'Enter', 'Enter', 13);
  assert.ok(await until(`document.activeElement?.id==='thinking-starters-select'`), 'keyboard open focuses starter selector');
  // Changing a starter needs no HTTP request and sends no socket message.
  await sleep(200);
  const requestCount = requests.length, heardCount = core.heard.length;
  for (let i = 0; i < 3; i++) {
    await choose(browser, ids[i]);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.thinking-starters-field label'),l=>l.textContent.replace(' (required)',''))`), labels[i]);
    assert.deepEqual(await values(browser), ['', '', '']);
  }
  assert.equal(requests.length, requestCount, 'three scaffolds create no network request');
  assert.deepEqual(core.heard.slice(heardCount).filter(m => m.type !== 'heartbeat'), [], 'choosing makes no app request');
  await choose(browser, 'choice');
  assert.equal(await evaluate(`document.querySelector('${css} button[type="submit"]').disabled`), true);
  await fill(browser, 1, 'Options alone');
  assert.equal(await evaluate(`document.querySelector('${css} button[type="submit"]').disabled`), true, 'first field required');
  await fill(browser, 1, ''); await fill(browser, 0, fields[0]);
  assert.equal(await evaluate(`document.querySelector('${css} button[type="submit"]').disabled`), true, 'one other field required');
  await fill(browser, 1, 'x'.repeat(1001));
  assert.equal((await values(browser))[1].length, 1000, 'field bound enforced on paste');
  await fill(browser, 1, fields[1]); await fill(browser, 2, fields[2]);
  await choose(browser, 'update'); await fill(browser, 0, 'Synthetic update'); await choose(browser, 'choice');
  assert.deepEqual(await values(browser), fields, 'unsent edits survive switching');
  await key(browser, 'Escape', 'Escape', 27);
  assert.ok(await until(`document.activeElement===document.querySelector('${css} button') && !document.querySelector('.thinking-starters-body')`), `Escape collapses and returns focus: ${q(await evaluate(`({open:!!document.querySelector('.thinking-starters-body'),active:document.activeElement?.outerHTML.slice(0,250)})`))}`);
  await open(browser);
  assert.deepEqual(await values(browser), fields, 'collapse keeps fields');
  await click(browser, 'Close'); await open(browser);
  assert.deepEqual(await values(browser), fields, 'Close keeps fields');
  assert.equal(JSON.stringify(core.state.world), baselineWorld, 'enable, fields and preview do not change map');
  for (const [width, height, scheme, reduced] of [[1440, 900, 'light', false], [390, 844, 'dark', true]]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    await choose(browser, 'unblock');
    assert.deepEqual(await values(browser), ['', '', ''], 'empty scaffold at each width');
    await geometry(browser, width, height);
    await screenshot(browser, `${width}-empty.png`);
    await choose(browser, 'choice');
    await geometry(browser, width, height);
    await screenshot(browser, `${width}-fields.png`);
    await click(browser, 'Preview');
    assert.equal(await evaluate(`document.querySelector('.thinking-starters-preview').textContent`), expected);
    assert.ok(await until("document.activeElement?.textContent === 'Thought preview'"), 'preview receives keyboard focus');
    await geometry(browser, width, height);
    await screenshot(browser, `${width}-preview.png`);
    await click(browser, 'Edit fields');
    // 200% text: the card scrolls; all labeled fields and its controls stay reachable.
    await evaluate(`document.querySelector('${css}').style.fontSize='200%'`);
    await geometry(browser, width, height);
    await evaluate(`document.querySelector('#thinking-starters-field-0').focus()`);
    assert.ok(await focusedControlVisible(browser), '200% textarea can be reached without crop in the body and host');
    await evaluate(`document.querySelector('${css} button[type="submit"]').focus()`);
    assert.ok(await focusedControlVisible(browser), '200% Preview control can be reached without crop in the body and host');
    await screenshot(browser, `${width}-text-200.png`);
    await evaluate(`document.querySelector('${css}').style.fontSize=''`);
  }
  await click(browser, 'Preview');
  const beforeSend = core.heard.filter(m => m.type === 'text').length;
  await evaluate(`{const b=[...document.querySelectorAll('${css} button')].find(b=>b.textContent==='Send as thought');b.click();b.click();}`);
  assert.ok(await until(`document.querySelector('.thinking-starters-status')?.textContent==='Submitted to E2A2O'`));
  assert.ok(await until(`!!document.querySelector('.map-capture-waiting')`));
  assert.ok(await until(`document.querySelector('.shell-status-wait')?.textContent==='Needs the AI key'`), 'existing keyless state, no model claim');
  assert.ok(await until(`document.querySelector('.map-capture-state')?.textContent==='Saved · placing needs an AI key'`), 'saved capture stays distinct from AI placement');
  assert.deepEqual(core.heard.filter(m => m.type === 'text').slice(beforeSend).map(m => m.text), [expected], 'real app sends exact preview once');
  const afterSend = JSON.stringify(core.state.world);
  // Remove unsent state by disabling through Features; the sent record remains.
  await click(browser, 'Close');
  await showFeatures(); await toggle('false');
  assert.ok(await until(`!document.querySelector('${css}')`), 'disable unmounts');
  await sleep(200);
  assert.equal(JSON.stringify(core.state.world), afterSend, 'disable adds no map change or deletion');
  await showFeatures(); await toggle('true'); await open(browser);
  assert.deepEqual(await values(browser), ['', '', ''], 'unmount clears unsent fields');
  await click(browser, 'Close'); await showFeatures(); await toggle('false');
  const offRequests = requests.length, offMessages = core.heard.length;
  await sleep(250);
  assert.equal(requests.length, offRequests, 'off has no background HTTP work');
  assert.deepEqual(core.heard.slice(offMessages).filter(m => m.type !== 'heartbeat'), [], 'off has no background socket work');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('#type-a-thought')`));
  assert.equal(await evaluate(`document.querySelector('${css}')`), null, 'disabled switch persists');
  await typeCapture(browser, 'A separate synthetic baseline thought');
  assert.ok(await until(`Array.from(document.querySelectorAll('.map-capture-waiting')).some(e=>e.textContent.includes('A separate synthetic baseline thought'))`), 'baseline composer still works');
  assert.equal(core.state.world.threads.length, 0, 'keyless fixture invented no placed result');
  assert.deepEqual(errors, [], 'no browser exceptions');
  assert.ok(requests.every(url => new URL(url).hostname === '127.0.0.1' || url.startsWith('data:')), 'all page requests remain local');
  console.log('f7-starters: real Features gate/persistence, three empty scaffolds, edits, bounds, exact send, keyless state, cleanup, phone/text/keyboard ok');
  console.log(`f7-starters screenshots: ${shots}`);
} finally { await browser?.close(); core.close(); }
