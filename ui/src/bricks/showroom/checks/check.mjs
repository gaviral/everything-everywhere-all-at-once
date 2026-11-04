import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { build } from '../../../../node_modules/vite/dist/node/index.js';
import react from '../../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage, standInCore } from '../../../../../scripts/headless.mjs';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ui = resolve(folder, '../../..');
const artifactRoot = join(folder, '.check-artifacts');
mkdirSync(artifactRoot, { recursive: true });
const artifacts = mkdtempSync(join(artifactRoot, 'run-'));
const manifest = JSON.parse(readFileSync(join(folder, 'brick.json'), 'utf8'));
assert.equal(manifest.id, 'showroom');
assert.equal(manifest.flag, 'showroom');
assert.equal(manifest.defaultOn, false);
const baseline = spawnSync('git', ['ls-tree', '-d', '--name-only', '1af6ef13', 'ui/src/bricks/'], { cwd: resolve(ui, '..'), encoding: 'utf8' });
assert.equal(baseline.status, 0);
assert.deepEqual(JSON.parse(readFileSync(join(folder, 'baseline-folders.json'), 'utf8')), baseline.stdout.trim().split('\n').map(path => path.split('/').at(-1)));

const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--allowSyntheticDefaultImports', '--resolveJsonModule', '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(folder, 'index.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ root: ui, configFile: false, plugins: [react()], logLevel: 'warn', build: { outDir: join(artifacts, 'built'), emptyOutDir: false,
  rolldownOptions: { input: { app: join(ui, 'index.html'), voice: join(folder, 'checks/voice.html') } } } });

const fixture = { threads: [{ id: 'showroom-example', title: 'Example · demo planning', parent_id: null, status: 'open', last_point: 'Try features and choose what stays', touched_ms: 1, tags: [], picture: null }],
  thoughts: [{ id: 'showroom-thought', speaker: 'you', text: 'Example: try features and choose what stays.', point: 'Try features and choose what stays', thread_id: 'showroom-example', placed: true, complete: true, at_ms: 1 }], active: 'showroom-example', active_by: {}, suggestions: [], actions: [], apps: [], notes: {} };
const core = await standInCore(() => [{ type: 'snapshot', world: fixture }], { port: 4377 });
const tunnels = new Set();
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/room') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ room: false, member: true })); return; }
  const file = resolve(artifacts, 'built', path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream'); response.end(readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
server.on('upgrade', (request, socket, head) => {
  const upstream = createConnection({ host: '127.0.0.1', port: core.port }, () => {
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${request.rawHeaders.reduce((lines, value, index, all) => index % 2 ? lines : lines + value + ': ' + all[index + 1] + '\r\n', '')}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  tunnels.add(upstream); tunnels.add(socket);
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  upstream.on('close', () => { tunnels.delete(upstream); socket.destroy(); });
  socket.on('close', () => { tunnels.delete(socket); upstream.destroy(); });
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(4378, '127.0.0.1', accept); });
let browser;
try {
  browser = await openPage('about:blank', { width: 1920, height: 1080, preserveProfile: true });
  const errors = [];
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  await browser.page('Runtime.enable');
  await browser.page('Page.enable');
  await browser.page('Page.addScriptToEvaluateOnNewDocument', { source: `window.micAttempts = 0; navigator.mediaDevices.getUserMedia = () => { window.micAttempts++; return Promise.reject(Error('No mic in this check')); };` });
  await browser.page('Page.navigate', { url: 'http://127.0.0.1:4378/?showroom' });
  const wait = async (expression, message) => assert.ok(await browser.until(expression, 12000), message);
  const evaluate = expression => browser.evaluate(expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const group = name => evaluate(`Array.from(document.querySelectorAll('.showroom-groups button')).find(button=>button.textContent.startsWith(${JSON.stringify(name)})).click()`);
  const key = async (value, code) => { await browser.page('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, windowsVirtualKeyCode: code }); await browser.page('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, windowsVirtualKeyCode: code }); };
  const screenshot = async name => { const { data } = await browser.page('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64')); };
  await wait(`!!document.querySelector('.showroom-dialog[open]')`, 'real app opens Showroom via its flag');
  await wait(`document.querySelectorAll('.showroom-card').length===4`, 'four real features open on the TV');
  const total = await evaluate(`Number(document.querySelector('.showroom-eyebrow').textContent.match(/([0-9]+) to/)[1])`);
  assert.ok(total > 100, 'full brick and built-in collection is present');
  assert.equal(await evaluate(`document.querySelector('.showroom-groups button[aria-pressed=true]').textContent.startsWith('New today')`), true);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.showroom-card')).every(card=>{const r=card.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})`), 'four cards fit at 1920x1080');
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.showroom-card h2')).fontSize)>=36`), 'TV card names are large');
  await screenshot('tv-new-today');
  await group('Demo candidates');
  await wait(`document.querySelector('[data-feature=draw]')?.getAttribute('aria-current')==='true'`, 'shortlist opens on Draw');
  for (let i = 0; i < 4; i++) await key('ArrowRight', 39);
  await wait(`document.querySelector('[data-feature=demo-parts]')?.getAttribute('aria-current')==='true'`, 'right moves by a card and crosses pages');
  await screenshot('tv-demo-candidates');
  await click('[data-feature=demo-parts] .showroom-try');
  await wait(`!!document.querySelector('.showroom-back') && document.querySelector('.demo-parts-example')?.textContent.includes('Demo candidates')`, 'Try enables and shows the real feature panel');
  assert.equal(await evaluate(`!!document.querySelector('.showroom-dialog[open]')`), false, 'showroom closes while trying');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.bricks'))['demo-parts']`), true);
  await click('.showroom-back');
  await wait(`document.querySelector('.showroom-decision')?.textContent.includes('Keep')`, 'Back asks for a decision');
  await click('.showroom-primary');
  await wait(`document.querySelector('[data-feature=demo-parts] .showroom-state')?.textContent==='On'`, 'Keep preserves on state and selected page');
  await click('[data-feature=demo-parts] .showroom-try');
  await wait(`!!document.querySelector('.showroom-back')`, 'can try an enabled feature again');
  await click('.showroom-back');
  await click('.showroom-decisions button:nth-child(2)');
  await wait(`document.querySelector('[data-feature=demo-parts] .showroom-state')?.textContent==='Off'`, 'Turn off disables feature and returns to exact card');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.bricks'))['demo-parts']`), false);
  await key('ArrowLeft', 37);
  await wait(`document.querySelector('[data-feature=flow-canvas]')?.getAttribute('aria-current')==='true'`, 'left crosses back one page');
  for (let i = 0; i < 4; i++) await key('ArrowRight', 39);
  await click('[data-feature=take-checklist] .showroom-try');
  await wait(`!!document.querySelector('.showroom-back') && document.querySelector('main.brick-view[data-brick="take-checklist"] .take-checklist')?.textContent.includes('Before the take.')`, 'Try renders the actual Take checklist content through the host');
  await wait(`(()=>{const title=document.querySelector('.take-checklist-title');if(!title)return false;const r=title.getBoundingClientRect();return title.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && r.top>=0 && r.bottom<innerHeight && !!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.take-checklist');})()`, 'view content is visible in the viewport and receives pointer hits');
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
  await screenshot('try-view');
  await click('.showroom-back');
  await click('.showroom-decisions button:nth-child(2)');
  await wait(`document.querySelector('[data-feature=take-checklist] .showroom-state')?.textContent==='Off'`, 'turning a view off returns to its showroom position');
  await group('Everything else');
  let found = false;
  for (let page = 0; page < 40; page++) {
    if (await evaluate(`!!document.querySelector('[data-feature="explicit-agreement"]')`)) { found = true; break; }
    for (let i = 0; i < 4; i++) await click('[aria-label="Next feature"]');
  }
  assert.ok(found, 'built-in appears in the live collection');
  await click('[data-feature="explicit-agreement"] .showroom-try');
  await wait(`!!document.querySelector('.showroom-back')`, 'built-in Try closes showroom');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.features'))['explicit-agreement']`), true);
  await click('.showroom-back');
  await click('.showroom-decisions button:nth-child(2)');
  await wait(`!!document.querySelector('.showroom-dialog[open]:not(.showroom-decision)')`, 'built-in decision returns to collection');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.features'))['explicit-agreement']`), false);
  await browser.page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await wait(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.showroom-dialog').scrollWidth<=document.querySelector('.showroom-dialog').clientWidth`, 'phone layout has no horizontal overflow');
  await screenshot('phone');
  assert.equal(await evaluate('window.micAttempts'), 0, 'no microphone requests');
  assert.deepEqual(errors, [], 'no runtime exceptions');
  await browser.page('Page.navigate', { url: 'http://127.0.0.1:4378/src/bricks/showroom/checks/voice.html' });
  await wait(`!!document.querySelector('[data-position]')`, 'synthetic voice fixture ready');
  const words = value => evaluate(`window.showroomWords(${JSON.stringify(value)})`);
  await words('next'); await words('next');
  await wait(`document.querySelector('[data-position]').textContent==='1'`, 'one voice word advances once across repeated partials');
  await words(''); await words('next.');
  await wait(`document.querySelector('[data-position]').textContent==='2'`, 'next utterance advances again');
  await words('back');
  await wait(`document.querySelector('[data-position]').textContent==='1'`, 'voice back moves a card');
  await words('please go next tomorrow');
  assert.equal(await evaluate(`document.querySelector('[data-position]').textContent`), '1', 'ordinary speech is not a command');
  await click('#pause'); await words('next');
  assert.equal(await evaluate(`document.querySelector('[data-position]').textContent`), '1', 'voice navigation is paused during a trial');
  await click('#pause'); await evaluate(`document.querySelector('input').focus()`); await key('ArrowRight', 39);
  assert.equal(await evaluate(`document.querySelector('[data-position]').textContent`), '1', 'arrows leave editing alone');
  console.log(`PASS showroom: scoped TypeScript, production build, baseline, real registry, 4 TV cards, groups, keyboard/voice paging, actual panel/view Try, keep/off, built-in switches, return position, phone layout, no mic. Artifacts: ${artifacts}`);
} catch (error) {
  if (browser) {
    writeFileSync(join(artifacts, 'failure.txt'), await browser.evaluate(`document.body.innerText`));
    writeFileSync(join(artifacts, 'layout.json'), JSON.stringify(await browser.evaluate(`(()=>{const title=document.querySelector('.take-checklist-title');return title?{rect:title.getBoundingClientRect().toJSON(),visible:title.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),ancestors:Array.from((function*(el){while(el){yield el;el=el.parentElement}})(title)).map(el=>({tag:el.tagName,cls:el.className,rect:el.getBoundingClientRect().toJSON(),visibility:getComputedStyle(el).visibility,position:getComputedStyle(el).position}))}:null})()`), null, 2));
    const { data } = await browser.page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, 'failure.png'), Buffer.from(data, 'base64'));
  }
  throw error;
} finally {
  await browser?.close();
  for (const socket of tunnels) socket.destroy();
  core.close();
  await new Promise(resolve => server.close(resolve));
}
