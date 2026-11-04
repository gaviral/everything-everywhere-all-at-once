// Isolated browser acceptance. No app shell, core, model, microphone or runtime service.
// Run: node scripts/intake1417-populated-variants-check.mjs
// Temporary cache/profile/screenshots are retained; only the Chrome PID started here is stopped.
import assert from 'node:assert/strict';
import { createServer } from '../ui/node_modules/vite/dist/node/index.js';
import react from '../ui/node_modules/@vitejs/plugin-react/dist/index.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const artifacts = mkdtempSync(join(tmpdir(), 'populated-variants-check-'));
const chromePath = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
assert.ok(chromePath, 'Chrome required for visible acceptance');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, socket, server;
async function startPreview() {
  server = await createServer({ configFile: false, root: new URL('../ui', import.meta.url).pathname,
    plugins: [react()], cacheDir: join(artifacts, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, ws: false, watch: null } });
  await server.listen();
  return `http://127.0.0.1:${server.httpServer.address().port}/src/intake1417/populated-variants/preview.html`;
}
async function startBrowser(url) {
  child = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(artifacts, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Owned browser PID ${child.pid}`);
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Chrome readiness timed out')), 20000);
    child.stderr.on('data', chunk => { log += chunk; const found = log.match(/DevTools listening on (ws:\/\/\S+)/); if (found) { clearTimeout(timer); resolve(found[1]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Owned Chrome exited before readiness')); });
    child.once('error', reject);
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => { const result = JSON.parse(event.data); if (result.id) { pending.get(result.id)?.(result); pending.delete(result.id); } };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const number = ++id;
    pending.set(number, result => result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result));
    socket.send(JSON.stringify({ id: number, method, params, sessionId }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => call(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await wait(50); }
    throw new Error(`TIMING: ${label}`);
  };
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.previewErrors=[]; addEventListener('error', e => previewErrors.push(e.message)); addEventListener('unhandledrejection', e => previewErrors.push(String(e.reason)));` });
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url });
  await until(`!!document.querySelector('[role=switch]')`, 'preview ready');
  return { page, evaluate, until };
}
const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)})`;
const visibleCount = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden').length`;
const shown = text => `document.body.innerText.includes(${JSON.stringify(text)})`;
async function press(browser, text, keyboard = false) {
  const expression = button(text);
  assert.ok(await browser.evaluate(`!!(${expression})`), `button available: ${text}`);
  if (keyboard) {
    await browser.evaluate(`(${expression}).focus()`);
    await browser.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await browser.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  } else await browser.evaluate(`(${expression}).click()`);
}
async function capture(browser, name) {
  const { data } = await browser.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
}
async function acceptance(browser) {
  const { evaluate, until, page } = browser;
  assert.equal(await evaluate(`document.querySelector('[role=switch]').getAttribute('aria-checked')`), 'false', 'fresh profile default off');
  assert.deepEqual(await evaluate(`({reads:populatedVariantsFixture.reads, subscriptions:populatedVariantsFixture.subscriptions})`), { reads: 0, subscriptions: 0 }, 'off does no candidate work or subscriptions');
  await press(browser, 'Populated variants: off', true);
  await until(`${visibleCount('.pv-version')}===2`, 'two readable presentations ready');
  assert.equal(await evaluate(visibleCount('nav[aria-label=Candidates] button')), 2, 'both populated candidates available');
  const semantic = await evaluate(`[...document.querySelectorAll('.pv-presentation')].map(p=>({title:p.querySelector('h4').innerText, text:[...p.querySelectorAll('p,li')].map(x=>x.innerText)}))`);
  assert.deepEqual(semantic[0], semantic[1], 'both versions preserve all visible meaning and content');
  assert.ok(await evaluate(shown('Proof missing · not demonstrated')), 'missing proof stays explicit');
  assert.ok(await evaluate(shown('Film-selected')), 'film selection is separately visible');
  assert.ok(await evaluate(shown('Sample descriptor only; no runtime demonstration')), 'supplied sample proof is not runtime demonstration');
  await press(browser, 'Keep B · Step cards', true);
  await until(shown('Kept B · Step cards'), 'choice feedback');
  await press(browser, 'Detail B', true);
  await until(`document.activeElement?.textContent==='B · Step cards · detail'`, 'detail keyboard focus');
  assert.ok(await evaluate(shown('Missing · not demonstrated')), 'detail cannot turn a missing proof into a demonstration');
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`document.activeElement?.textContent==='Detail B'`, 'return focus');
  assert.ok(await evaluate(shown('Kept B · Step cards')), 'choice survives detail return');
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.textContent'), 'Mark reviewed', 'natural tab order reaches the explicit review action');
  assert.notEqual(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'none', 'keyboard focus is visibly outlined');
  await press(browser, 'Mark reviewed', true);
  await until(`document.querySelector('.pv-status li').textContent==='Reviewed'`, 'explicit review feedback');
  assert.ok(await evaluate(shown('Proof missing · not demonstrated')), 'reviewing does not invent proof');
  await press(browser, 'Mark unreviewed', true);
  await until(`document.querySelector('.pv-status li').textContent==='Unreviewed'`, 'review can be undone');
  await press(browser, 'Mark reviewed', true);
  await until(`document.querySelector('.pv-status li').textContent==='Reviewed'`, 'review restored independently');
  await press(browser, 'A plan for a community garden');
  await until(shown('Kept B · Step cards'), 'same candidate visit');
  await press(browser, 'Questions for a repair café', true);
  await until(shown('No version chosen'), 'other candidate remains independent');
  assert.equal(await evaluate(`document.querySelectorAll('.pv-status')[1].firstElementChild.textContent`), 'Unreviewed', 'other candidate stays visibly unreviewed');
  assert.ok(await evaluate(shown('Supported · not shown')), 'supported-but-not-shown state separate');
  await press(browser, 'Keep A · Reading outline');
  await until(shown('Kept A · Reading outline'), 'second choice');
  await evaluate(`populatedVariantsFixture.candidates=populatedVariantsFixture.candidates.map((c,i)=>({...c,priority:i===0?'later':'film-likely'})); populatedVariantsFixture.changed()`);
  await until(`document.querySelector('nav button')?.textContent==='Questions for a repair café'`, 'candidate reorder');
  assert.ok(await evaluate(shown('Kept A · Reading outline')), 'stable part identity survives reorder');
  await press(browser, 'A plan for a community garden');
  await until(shown('Kept B · Step cards'), 'first choice retained after reorder');
  await press(browser, 'Keep A · Reading outline');
  await until(shown('Kept A · Reading outline'), 'iteration A');
  await press(browser, 'Keep B · Step cards');
  await until(shown('Kept B · Step cards'), 'iteration B');
  assert.ok(await evaluate(shown('Choice history (3)')), 'previous choices retained');
  await evaluate(`document.querySelector('details').open=true`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('details li')].map(e=>e.innerText)`), ['B · Step cards', 'A · Reading outline', 'B · Step cards'], 'visible iteration record retains alternatives');
  await capture(browser, 'desktop');
  await press(browser, 'Populated variants: on', true);
  await until(`!document.querySelector('.pv-root') && populatedVariantsFixture.subscriptions===0`, 'off cleanup');
  const reads = await evaluate('populatedVariantsFixture.reads');
  await page('Page.reload');
  await until(`!!document.querySelector('[role=switch]')`, 'off reload ready');
  assert.equal(await evaluate('populatedVariantsFixture.reads'), 0, 'off reload stays inert');
  assert.ok(reads > 0);
  await press(browser, 'Populated variants: off');
  await until(shown('Kept B · Step cards'), 'off/on retains choice');
  await page('Page.reload');
  await until(shown('Kept B · Step cards'), 'enabled reload retains choice');
  assert.equal(await evaluate(`document.querySelectorAll('.pv-status')[1].firstElementChild.textContent`), 'Unreviewed', 'review status persists separately');
  for (const [width, large] of [[390,false],[320,false],[320,true]]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.style.fontSize=${JSON.stringify(large ? '32px' : '16px')}`);
    await until(`document.documentElement.scrollWidth<=innerWidth`, `no horizontal overflow at ${width}, enlarged=${large}`);
    const layout = await evaluate(`({controls:[...document.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right}}), clipped:[...document.querySelectorAll('.pv-presentation,.pv-version,.pv-candidates>div')].some(p=>p.scrollWidth>p.clientWidth+1)})`);
    assert.equal(layout.clipped, false, 'readable wrapping');
    assert.ok(layout.controls.every(r=>r.height>=44 && r.left>=0 && r.right<=width), 'controls fit and remain reachable');
    await press(browser, 'Detail B', true);
    await until(`document.activeElement?.tagName==='H3'`, 'narrow detail focus');
    await press(browser, 'Back to comparison', true);
    await until(`document.activeElement?.textContent==='Detail B'`, 'narrow return focus');
    await capture(browser, `narrow-${width}${large?'-large':''}`);
  }
  // A denied save keeps the local selection visible with an honest persistence warning.
  await evaluate(`window.savedStorageWrite=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new Error('synthetic denied save')}`);
  await press(browser, 'Keep A · Reading outline');
  await until(shown('Choice kept for this visit only.'), 'failed save warning');
  assert.ok(await evaluate(shown('Kept A · Reading outline')), 'local choice remains available after save failure');
  await evaluate(`Storage.prototype.setItem=window.savedStorageWrite`);
  // Failure states use the same injected boundary, never a fake demonstration.
  await evaluate(`populatedVariantsFixture.candidates=[]; populatedVariantsFixture.changed()`);
  await until(shown('No candidates supplied yet.'), 'empty input');
  await evaluate(`populatedVariantsFixture.candidates=[{partId:'duplicate',priority:'later'},{partId:'duplicate',priority:'later'}]; populatedVariantsFixture.changed()`);
  await until(shown('Candidates unavailable.'), 'invalid input feedback');
  await page('Page.reload');
  await until(shown('Kept B · Step cards'), 'candidate recovery retains last successfully saved choice');
  assert.deepEqual(await evaluate('previewErrors'), [], 'no browser exceptions');
}
try {
  const url = await startPreview();
  const browser = await startBrowser(url);
  try { await acceptance(browser); } catch (error) {
    console.error("Visible failure evidence:", await browser.evaluate(`({body:document.body.innerText,errors:window.previewErrors,fixture:{reads:populatedVariantsFixture.reads,subscriptions:populatedVariantsFixture.subscriptions}})`));
    await capture(browser, "failure");
    console.error(`Failure artifacts: ${artifacts}`);
    throw error;
  }
  console.log('PASS intake1417-populated-variants: shared content, choices, detail return/focus, independent review/proof/film/support, reorder, history, keyboard, 320px/enlarged text, off/on/reload, save failure, empty/invalid input');
  console.log(`Screenshots and isolated browser artifacts: ${artifacts}`);
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, wait(5000)]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    child.stderr.destroy(); child.unref();
    console.log(`Owned browser PID ${child.pid} exited: ${child.exitCode ?? child.signalCode}`);
  }
  await server?.close();
}
