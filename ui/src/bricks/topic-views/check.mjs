import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(directory, '../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'topic-views-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.kind, 'view');
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'warn', build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'preview.html') } } });
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1:4388').pathname;
  const file = resolve(artifacts, 'built', path === '/' ? 'preview.html' : `.${path}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4388, '127.0.0.1', resolve); });
let page;
try {
  page = await openPage('http://127.0.0.1:4388/', { width: 1600, height: 1100, preserveProfile: true });
  const errors = [];
  page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await page.page('Runtime.enable');
  const wait = async (expression, message) => assert.ok(await page.until(expression), message);
  const click = async (selector, words) => page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => node.textContent.includes(${JSON.stringify(words)})).click()`);
  const fixture = async value => page.evaluate(`(()=>{const node=document.querySelector('#fixture');node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const body = `document.querySelector('.topic-views')?.textContent`;
  const paper = `document.querySelector('.topic-views-paper')?.textContent`;
  const selected = `document.querySelector('.topic-views-tree button[aria-pressed=true]')?.textContent`;
  const screenshot = async name => {
    const { data } = await page.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
  };
  await wait(`${body}?.includes('Interactive example')`, 'empty map opens with labelled material');
  await click('.topic-views-tree button', 'The first visit');
  await wait(`${paper}?.includes('Plant a seed. Take a pot home.')`, 'tree shows organized topic points');
  await click('.topic-views-source[data-source="example-2"] button', 'Read original');
  await wait(`document.activeElement?.dataset.source==='example-2'`, 'topic links focus exact original source');
  assert.ok(await page.evaluate(`${paper}.includes('For the opening, let people plant one seed and take a small pot home.')`), 'conversation shows original words rather than the point');
  assert.equal(await page.evaluate(`document.querySelectorAll('.topic-views-source').length`), 2, 'conversation filters to selected topic');
  assert.equal(await page.evaluate(`document.querySelector('#jump').textContent`), '', 'example never navigates host');
  await fixture('live');
  await click('.topic-views-tree button', 'The first visit');
  await click('.topic-views-source[data-source="example-2"] button', 'Keep reference');
  await click('.topic-views-switch button', 'Notes');
  await wait(`${paper}?.includes('Source example-2')`, 'Notes links the stable source identity');
  await page.evaluate(`(()=>{const node=document.querySelector('.topic-views-notes textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,'Keep the welcome simple.');node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`document.querySelector('.topic-views-notes textarea')?.value==='Keep the welcome simple.'`, 'independent note accepts writing');
  await click('.topic-views-reference button', 'Read source');
  await wait(`document.activeElement?.dataset.source==='example-2'`, 'note returns to original conversation source');
  await click('.topic-views-source[data-source="example-2"] button', 'Open on map');
  await wait(`!document.querySelector('.topic-views')`, 'host source navigation leaves view');
  assert.equal(await page.evaluate(`document.querySelector('#jump').textContent`), 'example-2', 'host receives exact source identity');
  await click('#mount', 'Return');
  await wait(`document.querySelector('.topic-views-switch button[aria-pressed=true]')?.textContent==='Conversation'`, 'return retains visible view');
  assert.ok(await page.evaluate(`${selected}.includes('The first visit')`), 'return retains topic');
  assert.equal(await page.evaluate(`document.querySelector('.topic-views-filter input').checked`), false, 'return retains visible filter');
  await click('.topic-views-switch button', 'Notes');
  await wait(`document.querySelector('.topic-views-notes textarea')?.value==='Keep the welcome simple.'`, 'return retains independent note');
  await click('#connection', 'Reconnect');
  await click('#connection', 'Reconnect');
  await click('#revision', 'Rename');
  await wait(`${selected}?.includes('A warm welcome')`, 'renamed canonical topic updates by identity');
  assert.equal(await page.evaluate(`document.querySelector('.topic-views-notes textarea').value`), 'Keep the welcome simple.', 'rename and reconnect retain note');
  await fixture('other');
  await click('.topic-views-switch button', 'Notes');
  assert.equal(await page.evaluate(`document.querySelector('.topic-views-notes textarea').value`), '', 'other map cannot inherit notes');
  await fixture('live');
  await wait(`document.querySelector('.topic-views-notes textarea')?.value==='Keep the welcome simple.'`, 'original visit restores notes');
  await fixture('changed');
  await wait(`${paper}?.includes('Source changed')`, 'changed source retains captured quote with explanation');
  await fixture('missing');
  await wait(`${paper}?.includes('Source no longer on map')`, 'missing source retains note and citation');
  assert.equal(await page.evaluate(`document.querySelector('.topic-views-reference button').disabled`), true, 'missing source cannot navigate');
  await fixture('live');
  await screenshot('notes-desktop');
  await click('.topic-views-tree button', 'Keep it growing');
  assert.equal(await page.evaluate(`document.querySelector('.topic-views-notes textarea').value`), '', 'each topic has independent notes');
  await click('.topic-views-switch button', 'Conversation');
  await page.evaluate(`document.querySelector('.topic-views-filter input').click()`);
  await wait(`document.querySelectorAll('.topic-views-source').length===4`, 'whole conversation includes all topic sources');
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.topic-views-source')).map(node=>node.dataset.source)`), ['example-1', 'example-2', 'example-3', 'example-4'], 'original time order crosses topic boundaries');
  await click('#mount', 'Hide');
  await click('#mount', 'Return');
  await wait(`document.querySelector('.topic-views-filter input')?.checked`, 'whole-conversation filter survives remount');
  await screenshot('conversation-desktop');
  for (const width of [390, 320]) {
    await page.page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    for (const view of ['Topic tree', 'Conversation', 'Notes']) {
      await click('.topic-views-switch button', view);
      await wait(`document.documentElement.scrollWidth<=innerWidth`, `${view} fits at ${width}px`);
    }
    await screenshot(`notes-${width}`);
  }
  await page.evaluate(`document.querySelector('.topic-views-switch button').focus()`);
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`document.querySelector('.topic-views-switch button[aria-pressed=true]')?.textContent==='Topic tree'`, 'view switch works by keyboard');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS topic-views: scoped TypeScript, isolated production bundle and browser; example/live, original source links, independent notes, jump-return selection/filter, reconnect/rename, map isolation, changed/missing source, chronological projection, keyboard, 1600/390/320px. Evidence: ${artifacts}`);
} finally {
  await page?.close();
  await new Promise(resolve => server.close(resolve));
}
