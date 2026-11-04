import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openBrowser } from '../../../../scripts/intake1422/hosted-release/browser.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(directory, '../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'i-compact-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false);
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable',
  '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
  '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'warn',
  build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'preview.html') } } });
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
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
  browser = await openBrowser(artifacts);
  const { evaluate, until, page } = browser;
  await page('Page.enable'); await page('Runtime.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.captureAttempts=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.captureAttempts++;throw Error('Capture forbidden')};` });
  await page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  const wait = expression => until(expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = text => evaluate(`[...document.querySelectorAll('.i-compact button')].find(button=>button.textContent.includes(${JSON.stringify(text)})).click()`);
  const field = (selector, value) => evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const first = '.i-compact-topic';
  const synthesis = `${first} textarea`;
  const questions = `${first} .i-compact-questions`;
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  await wait(`!!document.querySelector('.i-compact-point')`);
  assert.match(await text('.i-compact-context'), /Clearly labelled example/);
  assert.match(await text('.i-compact-point'), /if permission comes through/);
  await click('.i-compact-original summary');
  assert.ok(await evaluate(`document.querySelector('.i-compact-original').open`));
  assert.match(await text('.i-compact-original blockquote'), /wait rather than send invitations anyway/);
  await field(synthesis, 'Keep the pilot small and wait for permission.');
  await field(`${questions} input`, 'Who confirms permission?');
  await button('Record question');
  await wait(`document.querySelector('.i-compact-questions li')?.textContent.includes('Who confirms permission?')`);
  const heading = await evaluate(`document.querySelector('.i-compact-topic h2').id`);
  assert.equal(await evaluate(`document.querySelector('.i-compact-questions li a').hash`), `#${heading}`);
  await button('Change example source');
  await wait(`document.querySelector('.i-compact-synthesis [role=status]').textContent.includes('invalidated')`);
  assert.match(await text('.i-compact-point'), /four weeks/);
  await field(synthesis, 'Reviewing the four-week option.');
  assert.match(await text('.i-compact-synthesis [role=status]'), /invalidated/);
  await click(`${first} > summary`);
  assert.match(await text(`${first} > summary`), /Synthesis invalidated/);
  assert.equal(await evaluate(`document.querySelector('.i-compact-topic').open`), false);
  await click('#remount'); await wait(`!document.querySelector('.i-compact')`); await click('#remount');
  await wait(`!!document.querySelector('.i-compact-topic') && !document.querySelector('.i-compact-topic').open`);
  await click(`${first} > summary`);
  await button('I reviewed the current originals');
  await wait(`!document.querySelector('.i-compact-synthesis [role=status]').textContent.includes('invalidated')`);
  await click('#remount'); await wait(`!document.querySelector('.i-compact')`); await click('#remount');
  await wait(`document.querySelector('.i-compact textarea')?.value==='Reviewing the four-week option.'`);
  assert.match(await text('.i-compact-questions li'), /Who confirms permission/);
  await click('#live'); await button('This map');
  await wait(`document.querySelector('.i-compact-topic h2')?.textContent==='A live-shaped topic'`);
  await field(synthesis, 'Wait for permission.');
  const liveHeading = await evaluate(`document.querySelector('.i-compact-topic h2').id`);
  await click('.i-compact-original summary'); await button('Open on map');
  assert.equal(await evaluate(`document.body.dataset.openedSource`), 'source-one');
  await click('#remount'); await wait(`!document.querySelector('.i-compact')`); await click('#remount');
  await wait(`document.querySelector('.i-compact textarea')?.value==='Wait for permission.'`);
  assert.equal(await evaluate(`document.querySelector('.i-compact-toolbar button').getAttribute('aria-pressed')`), 'true', 'jump and return preserve visible map filter');
  await click('#change');
  await wait(`document.querySelector('.i-compact-synthesis [role=status]').textContent.includes('invalidated')`);
  assert.equal(await evaluate(`document.querySelector('.i-compact-topic h2').id`), liveHeading, 'renaming preserves heading identity');
  assert.match(await text('.i-compact-original blockquote'), /Changed original/);
  await click('#disconnect');
  await wait(`document.querySelector('.i-compact-synthesis button').disabled`);
  assert.match(await text('.i-compact'), /Freshness cannot be confirmed/);
  await click('#disconnect'); await button('I reviewed the current originals');
  await click('#remove');
  await wait(`document.querySelector('.i-compact-synthesis [role=status]').textContent.includes('invalidated')`);
  assert.equal(await evaluate(`document.querySelector('.i-compact-synthesis button').disabled`), true, 'missing sources cannot be reviewed');
  await click('#remove'); await click('#participant');
  await wait(`document.querySelector('.i-compact textarea')?.value===''`);
  await click('#participant');
  await wait(`document.querySelector('.i-compact textarea')?.value==='Wait for permission.'`);
  for (const width of [1920, 390]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: width === 1920 ? 1080 : 844, deviceScaleFactor: 1, mobile: false });
    await wait(`document.documentElement.scrollWidth<=innerWidth`);
    const screenshot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  assert.equal(await evaluate('window.captureAttempts'), 0);
  console.log('PASS i-compact: scoped TypeScript/build; exact originals; uncertainty; editable synthesis and invalidation; explicit review; topic questions and stable headings; fold; return/participant isolation; disconnect/removal; TV/phone; zero microphone calls.');
  console.log(`Artifacts retained: ${artifacts}`);
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(accept => server.close(accept));
}
