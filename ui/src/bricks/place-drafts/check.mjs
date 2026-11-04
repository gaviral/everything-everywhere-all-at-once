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
const artifacts = mkdtempSync(join(tmpdir(), 'place-drafts-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.id, 'place-drafts');
assert.equal(manifest.kind, 'view');
assert.equal(manifest.defaultOn, false);
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable',
  '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
  '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'index.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Focused TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: join(directory, 'checks'), plugins: [react()], logLevel: 'warn',
  build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'checks/preview.html') } } });
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = resolve(artifacts, 'built', pathname === '/' ? 'preview.html' : `.${pathname}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4387, '127.0.0.1', resolve); });
let page;
try {
  page = await openPage('http://127.0.0.1:4387/', { width: 1600, height: 1100, preserveProfile: true });
  const errors = [];
  page.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await page.page('Runtime.enable');
  const wait = async (expression, message) => assert.ok(await page.until(expression), message);
  const field = `document.querySelector('#place-drafts-editor')`;
  const heading = `document.querySelector('.place-drafts-reading h2')`;
  const click = async expression => page.evaluate(`${expression}.click()`);
  const fill = async text => {
    await page.evaluate(`(()=>{const field=${field};field.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(`${field}.value===${JSON.stringify(text)}`, 'native input receives exact draft');
  };
  const choose = async title => {
    await page.evaluate(`Array.from(document.querySelectorAll('.place-drafts-readings button')).find(b=>b.textContent.includes(${JSON.stringify(title)})).click()`);
    await wait(`${heading}?.textContent.includes(${JSON.stringify(title)})`, `reading changes to ${title}`);
  };
  const shot = async name => {
    const { data } = await page.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, name + '.png'), Buffer.from(data, 'base64'));
  };
  await wait(`${heading}?.textContent==='An interrupted thought' && !!window.readingFixture`, 'live reading opens populated');
  const headingId = await page.evaluate(`${heading}.id`);
  const draft = 'An unfinished sentence.\n  Keep the spacing and selection.  ';
  await fill(draft);
  await page.evaluate(`${field}.setSelectionRange(3,19,'backward');${field}.dispatchEvent(new Event('select',{bubbles:true}))`);
  await wait(`${field}.selectionStart===3 && ${field}.selectionEnd===19`, 'native draft range selected');
  await wait(`JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.includes('place-drafts')&&k.includes('synthetic-map-A'))))?.drafts['topic:alpha']?.start===3`, 'native selection checkpoint is durable before navigation');
  await click(`document.querySelector('[data-reading-block="alpha-0"] button')`);
  await wait(`document.querySelector('[data-reading-block="alpha-0"] button').getAttribute('aria-expanded')==='false'`, 'source folds');
  await page.evaluate(`(()=>{const words=document.querySelector('[data-reading-words="alpha-2"]');const range=document.createRange();range.setStart(words.firstChild,0);range.setEnd(words.firstChild,17);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
  await wait(`document.querySelector('.place-drafts-note blockquote')?.textContent.includes('Reading passage 3')`, 'source selection retained beside draft');
  await page.evaluate(`document.querySelector('.place-drafts-paper').scrollTop=500`);
  await wait(`document.querySelector('.place-drafts-paper').scrollTop>=499`, 'reading moves');
  const scrollBefore = await page.evaluate(`document.querySelector('.place-drafts-paper').scrollTop`);
  await wait(`JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.includes('place-drafts')&&k.includes('synthetic-map-A'))))?.places['topic:alpha']?.scroll===${scrollBefore}`, 'scroll checkpoint is durable before navigation');
  await click(`document.querySelector('[data-reading-block="alpha-2"] .place-drafts-link')`);
  await wait(`document.querySelector('#return')?.textContent==='Return to reader'`, 'original source opens through navigation');
  assert.ok(await page.evaluate(`document.body.textContent.includes('Original source: alpha-2')`), 'anchor resolves exact thought ID');
  await click(`document.querySelector('#return')`);
  await wait(`${field}?.value===${JSON.stringify(draft)}`, 'return restores native draft');
  assert.equal(await page.evaluate(`${heading}.id`), headingId, 'heading identity survives source trip');
  assert.equal(await page.evaluate(`document.querySelector('[data-reading-block="alpha-0"] button').getAttribute('aria-expanded')`), 'false', 'fold survives source trip');
  const scrollAfter = await page.evaluate(`document.querySelector('.place-drafts-paper').scrollTop`);
  assert.ok(Math.abs(scrollAfter - scrollBefore) <= 2, `reading offset survives source trip: before=${scrollBefore}, after=${scrollAfter}`);
  assert.deepEqual(await page.evaluate(`[${field}.selectionStart,${field}.selectionEnd,${field}.selectionDirection]`), [3, 19, 'backward'], 'native selection survives source trip');
  await choose('A finished helper result');
  assert.ok(await page.evaluate(`document.querySelector('.place-drafts-reading').textContent.includes('history')`), 'helper results are reading history');
  await fill('A separate helper-result draft');
  await choose('An interrupted thought');
  assert.equal(await page.evaluate(`${field}.value`), draft, 'per-source drafts do not replace one another');

  await page.page('Page.reload');
  await wait(`${field}?.value===${JSON.stringify(draft)}`, 'refresh restores exact draft and active reading');
  assert.equal(await page.evaluate(`document.querySelector('[data-reading-block="alpha-0"] button').getAttribute('aria-expanded')`), 'false', 'fold survives refresh');
  assert.deepEqual(await page.evaluate(`[${field}.selectionStart,${field}.selectionEnd,${field}.selectionDirection]`), [3, 19, 'backward'], 'native selection survives refresh');
  assert.ok(Math.abs(await page.evaluate(`document.querySelector('.place-drafts-paper').scrollTop`) - scrollBefore) <= 2, 'scroll survives refresh');
  assert.equal(await page.evaluate(`getSelection().toString()`), 'Reading passage 3', 'source range survives refresh');

  await page.evaluate(`${field}.focus();window.readingFixture.setVersion('renamed')`);
  await wait(`document.querySelector('.place-drafts-status').textContent.includes('Updates waiting')`, 'incoming refresh waits around active editing');
  assert.equal(await page.evaluate(`${heading}.textContent`), 'An interrupted thought', 'heading stays still while editing');
  await click(`document.querySelector('.place-drafts-status button')`);
  await wait(`${heading}.textContent==='A renamed heading'`, 'explicit readiness applies pending snapshot');
  assert.equal(await page.evaluate(`${heading}.id`), headingId, 'rename and reordering keep heading identity');
  assert.equal(await page.evaluate(`${field}.value`), draft, 'snapshot update keeps draft');
  assert.equal(await page.evaluate(`document.querySelector('[data-reading-block="alpha-0"] button').getAttribute('aria-expanded')`), 'false', 'rename keeps folds');
  // The same source block remains at the same visible offset after a preceding block arrives.
  const checkpoint = await page.evaluate(`JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.includes('place-drafts')&&k.includes('synthetic-map-A'))))`);
  const place = checkpoint.places['topic:alpha'];
  const offset = await page.evaluate(`Array.from(document.querySelectorAll('[data-reading-block]')).find(el=>el.dataset.readingBlock===${JSON.stringify(place.blockId)}).getBoundingClientRect().top-document.querySelector('.place-drafts-paper').getBoundingClientRect().top`);
  assert.ok(Math.abs(offset - place.offset) <= 2, 'stable source anchor preserves visible reading offset across insertion');
  await shot('desktop');

  await page.evaluate(`window.readingFixture.setIdentity('synthetic-map-B')`);
  await wait(`${field}?.value===''`, 'other map cannot inherit draft');
  await page.evaluate(`window.readingFixture.setIdentity('synthetic-map-A');window.readingFixture.setPerson('reader-B')`);
  await wait(`${field}?.value===''`, 'other person cannot inherit draft');
  await page.evaluate(`window.readingFixture.setPerson('reader-A')`);
  await wait(`${field}?.value===${JSON.stringify(draft)}`, 'original map/person returns to same draft');
  await page.evaluate(`getSelection().removeAllRanges();document.activeElement.blur();window.readingFixture.setVersion('missing')`);
  await wait(`document.querySelector('.place-drafts-missing')?.textContent.includes('Source not present')`, 'missing source keeps recovery visible');
  assert.equal(await page.evaluate(`${field}.value`), draft, 'missing source retains draft');
  await choose('Another reading');
  await click(`Array.from(document.querySelectorAll('.place-drafts-readings button')).find(b=>b.textContent.includes('source unavailable'))`);
  await wait(`${field}.value===${JSON.stringify(draft)}`, 'orphaned draft remains reachable');
  await page.evaluate(`getSelection().removeAllRanges();document.activeElement.blur();window.readingFixture.setVersion('initial')`);
  await wait(`${heading}.textContent==='An interrupted thought'`, 'returning source recovers same identity');

  for (const width of [390, 320]) {
    await page.page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait(`document.documentElement.scrollWidth<=innerWidth`, `fits ${width}px`);
    await shot(`phone-${width}`);
  }
  await page.evaluate(`window.readingFixture.setIdentity('pending')`);
  await wait(`document.querySelector('.place-drafts-status').textContent.includes('Fictional example')`, 'unconfirmed identity uses labelled example');
  assert.equal(await page.evaluate(`${field}.value`), '', 'example never inherits live draft');
  await page.evaluate(`window.readingFixture.setIdentity('empty-map');window.readingFixture.setVersion('empty')`);
  await wait(`document.querySelector('.place-drafts-reading').textContent.includes('No topics or helper results yet')`, 'identified empty map explains state');
  await fill('A draft before the first topic');
  await page.evaluate(`getSelection().removeAllRanges();document.activeElement.blur();window.readingFixture.setVersion('initial')`);
  await wait(`document.querySelector('.place-drafts-readings').textContent.includes('source unavailable')`, 'draft written before first topic stays reachable');
  assert.equal(await page.evaluate(`${field}.value`), 'A draft before the first topic', 'first arriving topic does not take over empty-map draft');

  await page.evaluate(`Storage.prototype.setItem=function(){throw new DOMException('Synthetic denied storage','QuotaExceededError')}`);
  await fill('Memory-only draft');
  await wait(`document.querySelector('[role="alert"]')?.textContent.includes('keep a copy')`, 'storage failure visibly limits refresh promise');
  await page.evaluate(`window.readingFixture.setVisible(false)`);
  await wait(`!!document.querySelector('#return')`, 'view hides');
  await click(`document.querySelector('#return')`);
  await wait(`${field}?.value==='Memory-only draft'`, 'denied storage retains draft during navigation');
  assert.deepEqual(errors, [], 'no browser exceptions or mutation actions');
  console.log(`PASS place-drafts: focused TypeScript + production bundle + browser checks for source navigation, refresh, heading identity, folds, caret/source selection, scroll anchors, deferred updates, helper drafts, missing sources, map/person isolation, empty state, storage denial and 390/320px. Artifacts: ${artifacts}`);
} finally {
  await page?.close();
  await new Promise(resolve => server.close(resolve));
}
