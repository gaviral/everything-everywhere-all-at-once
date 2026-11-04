import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(directory, '../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'part-lenses-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.id, 'part-lenses');
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.kind, 'view');

const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable',
  '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
  '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);

await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'warn',
  build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'preview.html') } } });

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://preview').pathname;
  const file = resolve(artifacts, 'built', pathname === '/' ? 'preview.html' : `.${pathname}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
// Explicit free test port. Never use either reserved port, even for a probe.
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4381, '127.0.0.1', resolve); });
let page;
try {
  page = await openPage('http://127.0.0.1:4381/', { width: 1600, height: 1200 });
  const errors = [];
  page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await page.page('Runtime.enable');
  const wait = async (expression, message) => assert.ok(await page.until(expression), message);
  const clickText = async (selector, text) => page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => node.textContent.includes(${JSON.stringify(text)})).click()`);
  const fixture = async value => {
    await page.evaluate(`(()=>{const el=document.querySelector('#fixture');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const body = `document.querySelector('.part-lenses')?.textContent`;
  const content = `document.querySelector('.part-lenses-paper')?.textContent`;
  const screenshot = async name => {
    const { data } = await page.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
  };

  await wait(`${content}?.includes('Give every thought a place to belong.')`, 'plain language opens with a complete example');
  assert.ok(await page.evaluate(`${body}.includes('Example · a conversation map')`), 'example is labelled');
  assert.ok(await page.evaluate(`parseFloat(getComputedStyle(document.querySelector('.part-lenses-big-line')).fontSize)>=40`), 'desktop explanation uses large text');
  await screenshot('plain-desktop');
  await clickText('.part-lenses-switch button', 'Developer');
  await wait(`${content}?.includes('FocusedConversationMap')`, 'developer shows subclass');
  assert.ok(await page.evaluate(`${content}.includes('ViewPart') && ${content}.includes('Composition') && ${content}.includes('Topic focus')`), 'class inheritance and composition are explicit');
  await screenshot('developer-desktop');
  await clickText('.part-lenses-pieces button', 'Thought card');
  await wait(`${content}?.includes('HighlightedThoughtCard')`, 'composition selects its actual child');
  await clickText('.part-lenses-switch button', 'Founder');
  await wait(`${content}?.includes('Make every contribution visible, without losing who said it.')`, 'founder pitch follows selected child');
  await page.evaluate(`document.querySelector('#mount').click()`);
  await wait(`!document.querySelector('.part-lenses')`, 'unmount succeeds');
  await page.evaluate(`document.querySelector('#mount').click()`);
  await wait(`${content}?.includes('Make every contribution visible, without losing who said it.')`, 'part and lens survive a hide and return');
  await clickText('.part-lenses-switch button', 'Plain language');
  await clickText('.part-lenses-pieces button', 'Point text');
  await wait(`${content}?.includes('Hold on to the words that carry the idea.')`, 'second-level child explains itself');
  assert.ok(await page.evaluate(`${content}.includes('No smaller parts supplied')`), 'leaf is honest about tree coverage');
  await clickText('.part-lenses-breadcrumbs button', 'Conversation map');
  await wait(`${content}?.includes('Give every thought a place to belong.')`, 'ancestor returns to whole');

  await clickText('.part-lenses-tree button', 'Thought card');
  for (const [condition, message] of [['missing', 'Part unavailable in this snapshot'], ['revision', 'Revision unavailable · requested v1, snapshot v2'], ['duplicate', 'Ambiguous part identity']]) {
    await fixture(condition);
    await wait(`${content}?.includes(${JSON.stringify(message)})`, `${condition} never invents an explanation`);
    assert.ok(await page.evaluate(`!document.querySelector('.part-lenses-big-line')`));
  }
  await fixture('empty');
  await wait(`${body}?.includes('No parts supplied.')`, 'empty supplied tree is visible');
  await fixture('unwritten');
  await wait(`${content}?.includes('Thought card brings Point text, Speaker tag together.')`, 'unwritten part explains only known composition');
  await clickText('.part-lenses-switch button', 'Developer');
  await wait(`${content}?.includes('No class or subclass model supplied')`, 'composition does not fabricate inheritance');
  await fixture('cycle');
  await wait(`document.querySelectorAll('.part-lenses-tree button').length===2`, 'cycles terminate with a visible occurrence');
  await clickText('.part-lenses-tree button', 'Repeated reference');
  await wait(`${content}?.includes('Repeated reference. This branch stops here.')`, 'repeated occurrence cannot expand forever');

  await fixture('example');
  await clickText('.part-lenses-tree button', 'Conversation map');
  await clickText('.part-lenses-switch button', 'Founder');
  await screenshot('founder-desktop');
  for (const width of [390, 320]) {
    await page.page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    for (const lens of ['Plain language', 'Developer', 'Founder']) {
      await clickText('.part-lenses-switch button', lens);
      await wait(`document.documentElement.scrollWidth<=innerWidth`, `${lens} fits at ${width}px`);
    }
    await screenshot(`founder-${width}`);
  }
  await page.evaluate(`document.querySelector('.part-lenses-switch button').focus()`);
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`${content}?.includes('Give every thought a place to belong.')`, 'keyboard selects a lens');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS part-lenses: scoped TypeScript + production bundle; all lenses, nested composition, breadcrumb, remount, missing/revision/duplicate/empty/cycle, keyboard, 1600px/390px/320px. Screenshots: ${artifacts}`);
} finally {
  await page?.close();
  await new Promise(resolve => server.close(resolve));
}
