import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const ui = resolve(directory, '../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'anchored-discussions-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.kind, 'view');
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'warn', build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'preview.html') } } });

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1:4387').pathname;
  const file = resolve(artifacts, 'built', pathname === '/' ? 'preview.html' : `.${pathname}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
// Fixed check port; never touch the two reserved ports. Keep Chrome's temporary profile reversible.
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4387, '127.0.0.1', resolve); });
let browser;
try {
  browser = await openPage('http://127.0.0.1:4387/', { width: 1600, height: 1100, preserveProfile: true });
  const errors = [];
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await browser.page('Runtime.enable');
  const wait = async (expression, message) => assert.ok(await browser.until(expression), message);
  const click = async (selector, text) => browser.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => !node.hidden && node.textContent.includes(${JSON.stringify(text)})).click()`);
  const fixture = async value => browser.evaluate(`(()=>{const node=document.querySelector('#fixture');node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const body = `document.querySelector('.anchored-discussions')?.textContent`;
  const state = `document.querySelector('.anchored-discussions-card')?.dataset.state`;
  const screenshot = async name => {
    const { data } = await browser.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
  };
  await wait(`${body}?.includes('Interactive example')`, 'empty map opens with labelled example');
  await click('.anchored-discussions button', 'Resolve example');
  await wait(`${state}==='resolved'`, 'example closes');
  await click('.anchored-discussions button', 'Read 2 replies');
  await wait(`!document.querySelector('.anchored-discussions-replies').hidden`, 'resolved example replies are discoverable');
  await click('.anchored-discussions button', 'Reopen example');
  await wait(`${state}==='open'`, 'example reopens');
  assert.equal(await browser.evaluate(`document.querySelector('#calls').textContent`), '0', 'example never calls host');

  await fixture('live');
  await wait(`!!document.querySelector('.anchored-discussions-filters')`, 'live exchanges replace example');
  assert.equal(await browser.evaluate(`document.querySelector('.anchored-discussions-source mark').textContent`), 'start with the map', 'frozen occurrence highlights exactly');
  assert.equal(await browser.evaluate(`document.querySelectorAll('.anchored-discussions-source mark').length`), 1, 'repeated quote has one captured occurrence');
  await screenshot('open-desktop');
  await click('#hold', 'Hold');
  await click('.anchored-discussions-controls button', 'Resolve discussion');
  await wait(`${body}?.includes('Saving…')`, 'pending acknowledgement visible');
  assert.equal(await browser.evaluate(state), 'open', 'no optimistic close before acknowledgement');
  assert.equal(await browser.evaluate(`document.querySelector('.anchored-discussions-controls button').disabled`), true);
  await click('#release', 'Release');
  await wait(`${state}==='resolved'`, 'matching host update closes discussion');
  await click('#hold', 'Hold');
  assert.ok(await browser.evaluate(`document.querySelector('.anchored-discussions-source mark')!==null`), 'source highlight remains after resolution');
  assert.ok(await browser.evaluate(`document.querySelector('.anchored-discussions-replies').hidden`), 'closed exchange folds replies');
  await click('.anchored-discussions button', 'Read 2 replies');
  await wait(`!document.querySelector('.anchored-discussions-replies').hidden`, 'resolved replies open beside source');
  await screenshot('resolved-desktop');
  await click('.anchored-discussions-filters button', 'Resolved');
  await click('.anchored-discussions-source button', 'Go to source');
  await wait(`!document.querySelector('.anchored-discussions')`, 'source jump leaves view');
  assert.equal(await browser.evaluate(`document.querySelector('#jump').textContent`), 'source', 'jump names exact source thought');
  await click('#mount', 'Return');
  await wait(`document.querySelector('.anchored-discussions-filters button[aria-pressed=true]')?.textContent==='Resolved (1)'`, 'visible filter survives jump and return');
  assert.ok(await browser.evaluate(`!document.querySelector('.anchored-discussions-replies').hidden`), 'expanded replies survive return');
  await click('#reply', 'Add');
  await wait(`${body}?.includes('New reply on resolved discussion')`, 'late reply is discoverable without implicit reopen');
  assert.equal(await browser.evaluate(state), 'resolved');
  await click('.anchored-discussions-filters button', 'All discussions');
  await click('.anchored-discussions-controls button', 'Reopen discussion');
  await wait(`${state}==='open'`, 'explicit reopen restores open exchange');
  await click('#refuse', 'Toggle');
  await click('.anchored-discussions-controls button', 'Resolve discussion');
  await wait(`${body}?.includes('Discussion changed. Review')`, 'host refusal visible');
  assert.equal(await browser.evaluate(state), 'open', 'refusal never fabricates saved status');
  await click('#refuse', 'Toggle');
  await click('#connected', 'Toggle');
  await wait(`document.querySelector('.anchored-discussions-controls button').disabled`, 'offline write disabled');
  await click('#connected', 'Toggle');
  await click('#enabled', 'Toggle');
  await wait(`${body}?.includes('Enable Discussion status')`, 'status opt-in required');
  await click('.anchored-discussions-controls button', 'Enable');
  assert.equal(await browser.evaluate(`document.querySelector('#jump').textContent`), 'features:discussion-status', 'enable goes to existing switch');
  await click('#enabled', 'Toggle');

  await fixture('changed');
  await wait(`${body}?.includes('Source changed · showing captured words')`, 'changed source labelled honestly');
  assert.ok(await browser.evaluate(`document.querySelector('.anchored-discussions-source blockquote').textContent.includes('🌿 Start with the map')`), 'captured revision stays beside replies');
  await fixture('missing');
  await wait(`${body}?.includes('Source no longer on map')`, 'missing source keeps exchange discoverable');
  assert.equal(await browser.evaluate(`document.querySelector('.anchored-discussions-source button')`), null, 'missing source has no false navigation');
  await fixture('live');
  await click('.anchored-discussions-filters button', 'Resolved');
  await wait(`${body}?.includes('No resolved discussions')`, 'empty filtered state explains itself');
  await fixture('other-visit');
  await wait(`document.querySelector('.anchored-discussions-filters button[aria-pressed=true]')?.textContent==='All discussions'`, 'other visit starts with its own filter');
  await fixture('live');
  await wait(`document.querySelector('.anchored-discussions-filters button[aria-pressed=true]')?.textContent==='Resolved (0)'`, 'original visit keeps its filter');
  await click('.anchored-discussions-filters button', 'All discussions');
  for (const width of [390, 320]) {
    await browser.page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait(`document.documentElement.scrollWidth<=innerWidth`, `view reflows at ${width}px`);
    await screenshot(`open-${width}`);
  }
  await browser.evaluate(`document.querySelector('.anchored-discussions-controls button').focus()`);
  await browser.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await browser.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`${state}==='resolved'`, 'keyboard closes exchange');
  assert.equal(await browser.evaluate(`document.activeElement.textContent`), 'Reopen discussion', 'keyboard focus stays on status control');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS anchored-discussions: scoped TypeScript, isolated production bundle and browser; example, acknowledged close/reopen, retained source/replies, jump-return filter, late reply, refusal/offline/opt-in, changed/missing source, visit scoping, keyboard, 1600/390/320px. Evidence: ${artifacts}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
