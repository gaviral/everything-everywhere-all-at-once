// Focused visible behavior with a synthetic vocabulary server. No capture, model or personal data.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPage, ready, standInCore } from './headless.mjs';
assert.equal(ready(), '', 'built UI and Chrome are required');
const evidence = mkdtempSync(join(tmpdir(), 'my-words-page-'));
const world = { threads: [], thoughts: [], active: null, active_by: {}, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], recaps: [], proposals: [], ai: [] };
let record = { revision: 0, terms: [] }, core, browser, pending;
core = await standInCore(query => query.has('map') ? [] : [{ type: 'snapshot', world }], { onMessage(message, query) {
  if (!query.has('map')) return;
  if (message.type === 'enable') core.send({ ok: true, saved: false, record });
  if (message.type === 'save') pending = message;
} });
assert.ok(![4360, 4399].includes(core.port));
try {
  browser = await openPage('about:blank', { preserveProfile: true });
  const { page, evaluate, until } = browser;
  await page('Page.enable'); await page('Runtime.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.__micCalls=0; if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.__micCalls++;throw Error('Microphone forbidden in vocabulary check')}` });
  const origin = `http://127.0.0.1:${core.port}`;
  await page('Page.navigate', { url: origin });
  assert.ok(await until('!!document.querySelector("#type-a-thought")', 15000));
  assert.equal(await evaluate('!!document.querySelector(".my-words")'), false, 'off by default');
  assert.ok(!core.heard.some(m => m.type === 'enable'));
  const click = async selector => { assert.ok(await until(`!!document.querySelector(${JSON.stringify(selector)})`), selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const button = async text => {
    assert.ok(await until(`Array.from(document.querySelectorAll('.my-words button, .my-words-dialog button')).some(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}))`), text);
    await evaluate(`Array.from(document.querySelectorAll('.my-words button, .my-words-dialog button')).find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
  };
  const fill = async (selector, text) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select()`); await page('Input.insertText', { text }); };
  const key = async (key, code, n) => { for (const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n }); };
  await click('[data-guide=catalog]');
  assert.equal(await evaluate(`document.querySelector('[role=switch][aria-label="My words"]').getAttribute('aria-checked')`), 'false');
  await click('[role=switch][aria-label="My words"]'); await key('Escape', 'Escape', 27);
  await button('Prepare next session');
  assert.ok(await until('document.querySelector(".my-words-dialog")?.open'));
  assert.ok(await until('document.querySelector(".my-words-status")?.textContent.includes("Ready")'));
  assert.ok(await evaluate('document.querySelector(".my-words-examples").textContent.includes("not saved")'));
  assert.equal(record.terms.length, 0);
  await fill('.my-words-fields input', 'Wayfinder');
  await fill('.my-words-fields label:last-child input', 'Synthetic person');
  await button('Add to draft');
  await button('Save for next session');
  assert.ok(await until('document.querySelector(".my-words-status").textContent.includes("Saving")'));
  assert.equal(await evaluate('document.querySelector(".my-words-status").textContent.includes("Saved ·")'), false, 'no premature acknowledgement');
  assert.deepEqual(pending.terms, [{ term: 'Wayfinder', explanation: 'Synthetic person' }]);
  record = { revision: 1, terms: pending.terms }; pending = null;
  core.send({ ok: true, saved: true, record });
  assert.ok(await until('document.querySelector(".my-words-status").textContent.startsWith("Saved ·")'));
  await fill('.my-words-fields input', '  wAYfinder  '); await button('Add to draft');
  assert.ok(await until('document.querySelector(".my-words-error")?.textContent.includes("already in the list")'));
  assert.equal(await evaluate('document.querySelectorAll(".my-words-term").length'), 1);
  await click('[aria-label="Remove Wayfinder"]');
  assert.equal(await evaluate('document.querySelectorAll(".my-words-term").length'), 0);
  await button('Undo removal');
  assert.equal(await evaluate('document.querySelectorAll(".my-words-term").length'), 1);
  for (const width of [1440, 390]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await until('document.querySelector(".my-words-dialog").getBoundingClientRect().right <= innerWidth'));
    assert.equal(await evaluate('document.querySelector(".my-words-dialog").scrollWidth > document.querySelector(".my-words-dialog").clientWidth + 1'), false, 'dialog has no horizontal overflow');
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(evidence, `editor-${width}.png`), Buffer.from(shot.data, 'base64'));
  }
  await key('Escape', 'Escape', 27);
  assert.ok(await until('!document.querySelector(".my-words-dialog")'));
  assert.ok(await evaluate('document.activeElement.textContent.includes("Prepare next session")'), 'focus returns after Escape');
  await click('[data-guide=catalog]'); await click('[role=switch][aria-label="My words"]');
  assert.ok(await until('!document.querySelector(".my-words")'));
  assert.equal(await evaluate('window.__micCalls'), 0);
  assert.ok(!core.heard.some(m => m.type === 'listen' && m.on), 'no listening operation');
  console.log(`my-words page: default-off, examples, draft, save acknowledgement, duplicates, remove/undo, keyboard/focus and desktop/390px passed. Screenshots: ${evidence}`);
} finally { await browser?.close(); core.close(); }
