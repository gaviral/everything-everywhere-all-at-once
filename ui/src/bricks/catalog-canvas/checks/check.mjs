import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { build } from '../../../../node_modules/vite/dist/node/index.js';
import react from '../../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage, standInCore } from '../../../../../scripts/headless.mjs';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ui = resolve(folder, '../../..');
mkdirSync(join(folder, '.check-artifacts'), { recursive: true });
const run = mkdtempSync(join(folder, '.check-artifacts/run-'));
const manifest = JSON.parse(readFileSync(join(folder, 'brick.json'), 'utf8'));
assert.equal(manifest.flag, 'everything');
assert.equal(manifest.defaultOn, false);
const typecheck = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--allowSyntheticDefaultImports', '--resolveJsonModule', '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(folder, 'index.tsx'), join(folder, 'checks/voice.tsx')], { encoding: 'utf8' });
assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
const built = join(run, 'built');
await build({ root: ui, configFile: false, plugins: [react()], logLevel: 'warn', build: { outDir: built, emptyOutDir: false, rolldownOptions: { input: { app: join(ui, 'index.html'), voice: join(folder, 'checks/voice.html') } } } });
let populated = true;
const world = () => ({ threads: populated ? [{ id: 'example', title: 'Plan the launch', parent_id: null, status: 'open', last_point: 'Make the first step clear', touched_ms: 1, tags: [], picture: null }] : [],
  thoughts: populated ? [{ id: 'one', speaker: 'you', text: 'Make the first step clear.', point: 'Make the first step clear', thread_id: 'example', placed: true, complete: true, at_ms: 1 }] : [], active: populated ? 'example' : null, active_by: {}, suggestions: [], actions: [], apps: [], notes: {} });
const core = await standInCore(() => [{ type: 'snapshot', world: world() }]);
const sockets = new Set();
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/room') { response.setHeader('Content-Type', 'application/json'); response.end('{"room":false,"member":true}'); return; }
  const file = resolve(built, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if (!file.startsWith(built + '/')) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream'); response.end(readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
server.on('upgrade', (request, client, head) => {
  const upstream = createConnection(core.port, '127.0.0.1', () => {
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  for (const socket of [client, upstream]) { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); }
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await openPage('about:blank', { width: 1920, height: 1080, preserveProfile: true });
  const errors = [];
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  await browser.page('Runtime.enable');
  await browser.page('Page.enable');
  await browser.page('Page.addScriptToEvaluateOnNewDocument', { source: `window.micAttempts=0; navigator.mediaDevices.getUserMedia=()=>{window.micAttempts++;return Promise.reject(Error('Microphone prohibited in this check'));};` });
  const wait = async (condition, description) => assert.ok(await browser.until(condition, 12000), description);
  const evaluate = expression => browser.evaluate(expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const escape = async () => { await browser.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await browser.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); };
  const shot = async name => { const { data } = await browser.page('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(run, name + '.png'), Buffer.from(data, 'base64')); };
  await browser.page('Page.navigate', { url: origin + '/?everything' });
  await wait(`document.querySelectorAll('.catalog-canvas-word').length===6`, 'flag opens six visible choices in the real app');
  await wait(`!document.querySelector('.intro-parts')`, 'opening animation has finished');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.catalog-canvas-word')).every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(el).fontSize.replace('px','')>=60})`), 'all six words are large and in view on a TV');
  assert.ok(await evaluate(`document.querySelector('.catalog-canvas-scroll').scrollHeight<=document.querySelector('.catalog-canvas-scroll').clientHeight+1`), 'entire mind map fits on the TV without scrolling');
  const overviewCount = await evaluate(`document.querySelectorAll('.catalog-canvas-tree text').length`);
  assert.ok(overviewCount > 110, 'all registry features have named branches on the overview');
  await shot('tv-overview');
  await click('[data-group=draw]');
  await wait(`!!document.querySelector('[data-feature=shapes]')`, 'Draw opens names and descriptions');
  await shot('tv-draw');
  await click('[data-feature=shapes]');
  await wait(`!!document.querySelector('.catalog-canvas-return') && JSON.parse(localStorage.getItem('e2a2o.bricks'))?.shapes===true`, 'Try enables the real feature and shows return control');
  await escape();
  await wait(`document.activeElement?.dataset.feature==='shapes' && !!document.querySelector('.catalog-canvas[open]')`, 'Esc returns to the exact feature with focus');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.bricks')).shapes`), false, 'unkept trial is restored to off');
  await escape();
  await click('[data-group=share]');
  await evaluate(`document.querySelector('[data-feature=take-checklist]').scrollIntoView({block:'center'}); window.catalogReturnScroll=document.querySelector('.catalog-canvas-scroll').scrollTop`);
  await click('[data-feature=take-checklist]');
  await wait(`!!document.querySelector('main[data-brick="take-checklist"] .take-checklist-title')`, 'view trial opens its actual rendered content');
  await click('.catalog-canvas-return button:nth-of-type(2)');
  await escape();
  await wait(`document.activeElement?.dataset.feature==='take-checklist'`, 'return restores view feature focus');
  assert.ok(await evaluate(`Math.abs(document.querySelector('.catalog-canvas-scroll').scrollTop-window.catalogReturnScroll)<=1`), 'return restores the same visible part of the cluster');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.bricks'))['take-checklist']`), true, 'Keep on keeps the view enabled');
  await escape();
  await click('[data-group=share]');
  await click('[data-feature=explicit-agreement]');
  await wait(`!!document.querySelector('.catalog-canvas-return')`, 'built-in feature can be tried');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.features'))['explicit-agreement']`), true);
  await escape();
  await wait(`document.activeElement?.dataset.feature==='explicit-agreement'`, 'built-in returns to same branch');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.features'))['explicit-agreement']`), false);
  await browser.page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await wait(`document.querySelector('.catalog-canvas').scrollWidth<=390 && document.querySelector('.catalog-canvas-scroll').scrollWidth<=390`, 'phone has no horizontal overflow');
  await shot('phone-cluster');
  await escape();
  await wait(`document.querySelectorAll('.catalog-canvas-word').length===6`, 'phone returns to overview');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.catalog-canvas-word')).every(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})`), 'every phone group word fits without clipping');
  await shot('phone-overview');
  assert.equal(await evaluate('window.micAttempts'), 0, 'no capture requested by feature trials');
  populated = false;
  await browser.page('Page.navigate', { url: origin + '/?everything' });
  await wait(`document.querySelectorAll('.catalog-canvas-word').length===6`, 'empty map still opens with real content');
  await click('[data-group=understand]');
  await wait(`document.querySelectorAll('.catalog-canvas-leaf').length>15`, 'empty map includes populated feature descriptions');
  assert.equal(await evaluate('window.micAttempts'), 0);
  await browser.page('Page.navigate', { url: origin + '/src/bricks/catalog-canvas/checks/voice.html' });
  await wait(`!!document.querySelector('[data-visits]')`, 'synthetic words fixture mounted');
  const groups = await evaluate('window.catalogGroups');
  const registry = await evaluate('window.catalogRegistry');
  const assigned = groups.flatMap(group => group.ids);
  assert.equal(new Set(assigned).size, assigned.length, 'features have exactly one home');
  assert.deepEqual([...assigned].sort(), [...registry].sort(), 'every live registry id has an explicit mapping');
  assert.equal(overviewCount, registry.length, 'overview contains every actual feature exactly once');
  await evaluate(`window.catalogWords('draw'); window.catalogWords('draw')`);
  await wait(`document.querySelector('[data-group]').dataset.group==='draw' && document.querySelector('[data-visits]').dataset.visits==='1'`, 'repeated partial voice event navigates only once');
  await evaluate(`window.catalogWords(''); window.catalogWords('Build.')`);
  await wait(`document.querySelector('[data-group]').dataset.group==='build'`, 'new utterance opens its group');
  await evaluate(`window.catalogWords('we should build this tomorrow')`);
  assert.equal(await evaluate(`document.querySelector('[data-group]').dataset.group`), 'build', 'ordinary speech does not navigate');
  await click('button');
  await evaluate(`window.catalogWords('share')`);
  assert.equal(await evaluate(`document.querySelector('[data-group]').dataset.group`), 'build', 'trial pauses voice navigation');
  assert.deepEqual(errors, [], 'no runtime exceptions');
  console.log(`PASS catalog-canvas: scoped types, production build, ${registry.length} mapped features, TV/phone/empty content, panel/view/built-in trials, keep/restore, Esc focus, voice, no microphone. Screenshots: ${run}`);
} catch (error) {
  if (browser) { await browser.page('Page.captureScreenshot', { format: 'png' }).then(({ data }) => writeFileSync(join(run, 'failure.png'), Buffer.from(data, 'base64'))); writeFileSync(join(run, 'failure.txt'), await browser.evaluate('document.body.innerText')); }
  throw error;
} finally {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  core.close();
  await new Promise(done => server.close(done));
}
