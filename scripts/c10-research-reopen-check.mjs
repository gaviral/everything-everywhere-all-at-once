// Focused visible acceptance; synthetic host, real feature, no model or microphone.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createVite } from '../ui/node_modules/vite/dist/node/index.js';
import react from '../ui/node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from './headless.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'research-reopen-'));
const root = new URL('../ui/', import.meta.url).pathname;
const vite = await createVite({ root, cacheDir: join(artifacts, 'vite-cache'), configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false } });
const server = createServer(vite.middlewares);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert.ok(![4360, 4399].includes(port));
const origin = `http://127.0.0.1:${port}`;
let browser;
const errors = [], external = [];
try {
  const manifest = JSON.parse(readFileSync(new URL('../ui/src/bricks/question-research/brick.json', import.meta.url)));
  assert.equal(manifest.defaultOn, false);
  browser = await openPage('about:blank', { width: 1280, height: 1000, preserveProfile: true });
  const { page, evaluate, until } = browser;
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  browser.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
  browser.on('Network.requestWillBeSent', e => { if (/^https?:/.test(e.request.url) && !e.request.url.startsWith(origin + '/')) external.push(e.request.url); });
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.mediaAttempts=0; if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.mediaAttempts++;throw Error('Media forbidden in focused check')};` });
  const wait = async (expression, label) => assert.ok(await until(expression, 10000), `TIMING: ${label}`);
  const clickSelector = async selector => {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('REAL: missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const click = async text => {
    const selector = await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('REAL: missing button '+${JSON.stringify(text)});e.dataset.testClick='target';return '[data-test-click="target"]'})()`);
    await clickSelector(selector); await evaluate(`document.querySelector('[data-test-click="target"]')?.removeAttribute('data-test-click')`);
  };
  const select = async value => evaluate(`(()=>{const e=document.querySelector('.question-research select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const text = () => evaluate('document.querySelector(".question-research")?.innerText ?? ""');
  const shot = async name => { const result = await page('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64')); };
  await page('Page.navigate', { url: `${origin}/src/bricks/question-research/preview.html` });
  await wait('!!document.querySelector("[role=switch]")', 'preview controls');
  assert.equal(await evaluate('!!document.querySelector(".question-research")'), false, 'feature starts off');
  await click('Switch on'); await wait('!!document.querySelector(".question-research")', 'feature on');
  assert.equal(await evaluate('document.querySelector(".question-research blockquote").textContent'), 'When does the blue venue open?');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Synthetic request count"]').textContent`), 'Requests: 0', 'selection never starts research');
  await click('Research'); await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="Complete pending request")', 'pending fixture');
  await click('Complete pending request'); await wait('!!document.querySelector(".question-research-preview")', 'answer preview');
  assert.ok((await text()).includes('Kept evidence (0/30)'), 'preview is not attached');
  await click('Keep answer'); await wait('!!document.querySelector(".question-research-reader")', 'acknowledged attachment');
  assert.ok((await text()).includes('Attached answer'));
  assert.equal(await evaluate('document.activeElement.textContent'), 'Attached answer', 'reader receives focus');
  await click('Close evidence'); assert.equal(await evaluate('!!document.querySelector(".question-research-reader")'), false);
  await select('question-two');
  await evaluate(`(()=>{const e=document.querySelector('.question-research textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Access query in progress');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click('Reopen evidence');
  assert.equal(await evaluate('document.querySelector(".question-research-reader blockquote").textContent'), 'When does the blue venue open?');
  assert.equal(await evaluate('document.querySelector(".question-research textarea").value'), 'Access query in progress', 'reopening preserves the other query draft');
  assert.equal(await evaluate('document.querySelector(".question-research-reader a").href'), 'https://example.com/hours');
  await click('Show original thought');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Opened map thought"]').textContent`), 'On the map: When does the blue venue open?');
  assert.ok(await evaluate('!!document.querySelector(".question-research-reader")'), 'evidence stays beside the original after jump');
  await page('Page.reload'); await wait('!!document.querySelector("[role=switch]")', 'reload'); await click('Switch on');
  await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="Reopen evidence")', 'saved attachment after reload');
  await click('Reopen evidence');
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate('document.querySelector(".question-research-reader").scrollIntoView({block:"center"})');
    assert.ok(await evaluate('(()=>{const e=document.querySelector(".question-research");return e.scrollWidth<=e.clientWidth+1})()'), 'reader reflows');
    assert.ok(await evaluate('(()=>{const r=document.querySelector(".question-research-reader").getBoundingClientRect(),a=document.querySelector(".question-research-original").getBoundingClientRect(),b=document.querySelector(".question-research-attached").getBoundingClientRect();return innerWidth>580 ? b.x>a.x&&Math.abs(a.y-b.y)<2 : b.y>a.y&&r.width<=innerWidth})()'), 'beside on desktop, stacked on phone');
    await shot(`${width}-${theme}`);
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click('Change original'); assert.ok((await text()).includes('Source changed'));
  assert.equal(await evaluate('document.querySelector(".question-research-reader blockquote").textContent'), 'When does the blue venue open?', 'saved quote is immutable');
  await click('Show original thought'); assert.ok((await evaluate(`document.querySelector('[aria-label="Opened map thought"]').textContent`)).includes('revised opening hours'));
  await click('Remove original from preview'); assert.ok((await text()).includes('Source no longer on map'));
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="Show original thought").disabled'), true);
  await click('Go offline'); await click('Close evidence'); await click('Reopen evidence');
  assert.equal(await evaluate('document.querySelector(".question-research-reader .question-research-evidence > p").textContent'), 'The venue opens at nine [Example venue guide].', 'offline evidence and its inline citation remain readable');
  assert.equal(await evaluate('document.querySelector(".question-research-remove").disabled'), true);
  await click('Reconnect'); await click('Remove answer'); await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="Undo removal")', 'removed record');
  await click('Undo removal'); await wait('[...document.querySelectorAll("button")].some(e=>e.textContent==="Reopen evidence")', 'restored attachment');
  await select('question-two'); await click('Research'); await click('Cancel'); await click('Complete pending request');
  assert.equal(await evaluate('!!document.querySelector(".question-research-preview")'), false, 'cancel suppresses late answer');
  await click('Empty example map'); await wait('!!document.querySelector(".question-research-example")', 'labelled example');
  assert.ok((await text()).includes('EXAMPLE · FICTIONAL VENUE'));
  assert.equal(await evaluate('document.querySelector(".question-research-actions button").disabled'), true, 'example cannot be researched or attached');
  assert.equal(await evaluate('window.mediaAttempts'), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({ result: 'PASS', checks: ['default off', 'explicit research and keep', 'reopen with exact quote and citation', 'draft preserved', 'jump to source', 'reload', '390/1280 light/dark reduced motion', 'changed and missing source', 'offline reading', 'remove and undo', 'cancel late answer', 'labelled empty example', 'no media or external requests'], limitation: 'Synthetic host and local preview persistence; no live Meta request or core persistence claim.' }, null, 2));
  console.log(`PASS c10-research-reopen: focused browser check; artifacts ${artifacts}`);
} catch (error) {
  if (browser) {
    writeFileSync(join(artifacts, 'failure.txt'), await browser.evaluate('document.body.innerText').catch(() => 'Page unavailable'));
    const shot = await browser.page('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (shot) writeFileSync(join(artifacts, 'failure.png'), Buffer.from(shot.data, 'base64'));
  }
  console.error(`Retained failure artifacts: ${artifacts}`); throw error;
} finally {
  await browser?.close();
  await vite.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
