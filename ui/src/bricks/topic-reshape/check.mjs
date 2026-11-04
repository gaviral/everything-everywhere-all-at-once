import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(directory, '../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'topic-reshape-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.kind, 'view');
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable',
  '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
  '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'warn',
  build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'preview.html') } } });
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(artifacts, 'built', pathname === '/' ? 'preview.html' : `.${pathname}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${server.address().port}/`, { width: 1920, height: 1080, preserveProfile: true });
  const { evaluate, until, page } = browser;
  await page('Runtime.enable');
  const errors = [];
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  const wait = async (expression, message) => assert.ok(await until(expression), message);
  const click = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = async text => evaluate(`[...document.querySelectorAll('.topic-reshape button')].find(button => button.textContent.includes(${JSON.stringify(text)})).click()`);
  const field = async (selector, value) => evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${selector.includes('select') ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(${selector.includes('select') ? "'change'" : "'input'"},{bubbles:true}));})()`);
  const current = `document.querySelector('[aria-label="Current working copy"]')`;
  const snapshot = () => evaluate(`${current}.innerHTML`);
  const review = async () => { await button('Preview reshape'); await wait(`!!document.querySelector('[aria-label="Reshape preview"]')`, 'preview opens'); };
  const confirm = async () => { await button('Confirm in local copy'); await wait(`!!${current}`, 'confirmation shows working copy'); };
  const undo = async expected => { await button('Undo last reshape'); await wait(`${current}?.innerHTML === ${JSON.stringify(expected)}`, 'Undo restores exact visible content, hierarchy and order'); };
  await wait(`!!${current}`, 'labelled example opens without a live core');
  assert.match(await evaluate(`document.querySelector('.topic-reshape-badge').textContent`), /Example content.*local rehearsal/);
  const original = await snapshot();
  await button('Preview reshape');
  await wait(`document.querySelector('[role="status"]').textContent.includes('Give the new topic a name')`, 'empty split refused');
  await field('.topic-reshape-editor input:not([type=checkbox])', 'First invitations');
  await click('.topic-reshape-point-choice:last-child input');
  await review();
  assert.ok(await evaluate(`document.querySelector('[aria-label="Before reshape"]').textContent.includes('Invite five teams')`));
  assert.ok(await evaluate(`document.querySelector('[aria-label="After reshape"] [data-copy-topic="reshape-copy-1"]').textContent.includes('Invite five teams')`));
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(`!!${current}`, 'Escape cancels');
  assert.equal(await snapshot(), original, 'preview and cancel never change copy');
  assert.ok(await evaluate(`document.activeElement.textContent.includes('Preview reshape')`), 'cancel returns focus');
  await review(); await confirm();
  assert.ok(await evaluate(`document.activeElement.textContent.includes('Undo last reshape')`), 'confirm focuses Undo');
  const split = await snapshot();
  await button('Merge');
  await field('.topic-reshape-editor label:last-of-type select', 'audience');
  await review(); await confirm();
  assert.ok(await evaluate(`${current}.textContent.includes('↳ Find our first people')`), 'merge reparents children');
  await undo(split); await undo(original);
  await button('Change parent');
  await field('.topic-reshape-editor label:last-of-type select', 'audience');
  await review(); await confirm();
  assert.ok(await evaluate(`${current}.textContent.includes('↳ Find our first people')`), 'parent change visible');
  await undo(original);
  await field('.topic-reshape-editor > label select', 'story');
  await button('Change parent'); await review(); await confirm();
  assert.ok(await evaluate(`${current}.querySelector('[data-copy-topic="story"]').textContent.includes('Top-level topic')`), 'branch becomes top level');
  await undo(original);
  await button('Merge');
  assert.equal(await evaluate(`[...document.querySelectorAll('.topic-reshape-editor label:last-of-type select option')].some(option=>option.value==='story')`), false, 'descendant destinations excluded');
  for (const [width, scheme] of [[1920, 'light'], [390, 'light'], [390, 'dark']]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: width === 1920 ? 1080 : 844, deviceScaleFactor: 1, mobile: width < 600 });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(`document.documentElement.scrollWidth <= innerWidth`, `${width}px has no horizontal overflow`);
    const screenshot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${width}-${scheme}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  await field('.topic-reshape-editor label:last-of-type select', 'audience');
  await review(); await confirm();
  await click('#change-visit');
  await wait(`${current}?.innerHTML === ${JSON.stringify(original)}`, 'another visit starts with a fresh copy');
  assert.deepEqual(errors, []);
  console.log('PASS topic-reshape: scoped TypeScript/build; split, merge, parent/top-level preview and confirm; cancel/focus; exact stacked Undo; cycle exclusion; visit reset; TV/phone. No host writes or microphone.');
  console.log(`Screenshots retained: ${artifacts}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(accept => server.close(accept));
}
