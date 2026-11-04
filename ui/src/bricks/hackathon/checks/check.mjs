// One isolated browser check; only this feature is mounted, with a disconnected map.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from '../../../../node_modules/vite/dist/node/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const folder = resolve(here, '..');
const ui = resolve(here, '../../../..');
const roots = readdirSync(folder).filter(name => /\.tsx?$/.test(name)).map(name => join(folder, name));
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--ignoreConfig', '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--resolveJsonModule', '--allowSyntheticDefaultImports', '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--noUnusedLocals', '--noUnusedParameters', ...roots, join(here, 'main.tsx'), join(ui, 'src/vite-env.d.ts')], { encoding: 'utf8' });
assert.equal(types.status, 0, types.stdout + types.stderr);
const manifest = JSON.parse(readFileSync(join(folder, 'brick.json'), 'utf8'));
assert.equal(manifest.id, 'hackathon');
assert.equal(manifest.flag, 'hackathon');
assert.equal(manifest.kind, 'view');
assert.equal(manifest.defaultOn, false);
const artifacts = join(folder, '.check-artifacts');
mkdirSync(artifacts, { recursive: true });
const run = mkdtempSync(join(artifacts, 'run-'));
const vite = await createViteServer({ configFile: false, root: ui, cacheDir: join(run, 'vite'), server: { middlewareMode: true, hmr: false, watch: null } });
const server = createServer((request, response) => vite.middlewares(request, response));
// Ask the OS for an ephemeral port; neither reserved user port is bound or probed.
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const port = server.address().port;
assert.ok(![4360, 4399].includes(port));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(run, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let serial = 0, buffer = '';
const pending = new Map();
chrome.stdio[4].on('data', data => {
  buffer += data.toString();
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const task = pending.get(reply.id);
    if (task) { clearTimeout(task.timer); pending.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.accept(reply.result); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((accept, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
  pending.set(id, { accept, reject, timer });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});
try {
  await send('Browser.getVersion');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const value = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const waitFor = async expression => assert.equal(await evaluate(`new Promise(resolve => {
    const end = performance.now() + 7000;
    const poll = () => { if (${expression}) resolve(true); else if (performance.now() > end) resolve(false); else requestAnimationFrame(poll); }; poll();
  })`), true, expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.checkErrors = []; window.micAttempts = 0;
    addEventListener('error', e => checkErrors.push(e.message)); addEventListener('unhandledrejection', e => checkErrors.push(String(e.reason)));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { micAttempts++; throw Error('Microphone forbidden'); };
  ` });
  await page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const url = `http://127.0.0.1:${port}/src/bricks/hackathon/checks/index.html`;
  await page('Page.navigate', { url });
  await waitFor(`document.querySelectorAll('.hackathon-deliverable').length === 4`);
  assert.equal(await evaluate('typeof window.micAttempts'), 'number', 'Microphone guard installed before feature load');
  assert.equal(await evaluate(`document.querySelector('.hackathon-ready').textContent`), '0 / 4 ready');
  assert.equal(await evaluate(`hackathonCheck.content.rubric.reduce((n, item) => n + item.points, 0)`), 100);
  assert.equal(await evaluate(`Date.parse(hackathonCheck.content.deadline)`), Date.parse('2026-11-05T03:00:00Z'));
  assert.deepEqual(await evaluate(`hackathonCheck.timeRemaining(hackathonCheck.content.deadline, Date.parse('2026-11-05T02:59:58Z'))`), { closed: false, hours: '00', minutes: '00', seconds: '02' });
  assert.equal(await evaluate(`document.querySelector('[role="timer"]').getAttribute('aria-label')`), await evaluate(`(() => { const t = hackathonCheck.timeRemaining(hackathonCheck.content.deadline, Date.now()); return t.closed ? 'Deadline reached' : t.hours + ' hours ' + t.minutes + ' minutes ' + t.seconds + ' seconds remaining'; })()`));
  await evaluate(`(() => { const field = document.querySelector('select'); field.value = 'ready'; field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelector('.hackathon-ready').textContent === '1 / 4 ready'`);
  await click('.hackathon-navigation button:nth-child(2)');
  await waitFor(`!!document.querySelector('.hackathon-tracks')`);
  assert.equal(await evaluate(`document.querySelectorAll('.hackathon-rules-list article').length`), 4);
  assert.match(await evaluate(`document.querySelector('.hackathon-tracks').textContent`), /To verify/);
  await click('.hackathon-navigation button:nth-child(3)');
  await waitFor(`document.querySelectorAll('textarea').length === 5`);
  assert.match(await evaluate(`document.querySelector('.hackathon-context').textContent`), /Example answers/);
  const editName = async text => {
    await evaluate(`(() => { const field = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  };
  await editName('A reviewed public title');
  await click('.hackathon-draft button');
  await waitFor(`document.querySelector('.hackathon-draft button').getAttribute('aria-pressed') === 'true'`);
  await editName('A revised public title');
  await waitFor(`document.querySelector('.hackathon-draft button').getAttribute('aria-pressed') === 'false'`);
  await page('Page.navigate', { url });
  await waitFor(`document.querySelector('textarea')?.value === 'A revised public title'`);
  await editName('');
  await waitFor(`document.querySelector('.hackathon-draft button').disabled`);
  await click('.hackathon-navigation button:first-child');
  await waitFor(`document.querySelector('.hackathon-ready')?.textContent === '1 / 4 ready'`);
  assert.equal(await evaluate(`hackathonCheck.itemState({...hackathonCheck.content.deliverables[0], detail: 'Changed requirement'}, {source: JSON.stringify(hackathonCheck.content.deliverables[0]), state: 'ready'})`), 'pending');
  assert.equal(await evaluate(`hackathonCheck.draftValue({id: 'new', label: 'New', answer: 'Updated draft'}, {source: 'Old draft', text: 'Old answer', reviewed: true}).reviewed`), false);
  // Exercise actual timer updates and a tab returning at the cutoff without fixed sleeps.
  await evaluate(`window.realNow = Date.now; window.clockStart = performance.now(); Date.now = () => Date.parse('2026-11-05T02:59:58Z') + performance.now() - clockStart; dispatchEvent(new Event('focus'));`);
  await waitFor(`document.querySelector('[role="timer"]').getAttribute('aria-label') === '00 hours 00 minutes 02 seconds remaining'`);
  await waitFor(`document.querySelector('[role="timer"]').getAttribute('aria-label') === '00 hours 00 minutes 01 seconds remaining'`);
  await evaluate(`Date.now = () => Date.parse('2026-11-05T03:00:00Z'); document.dispatchEvent(new Event('visibilitychange'));`);
  await waitFor(`document.querySelector('[role="timer"]').textContent === 'Deadline reached'`);
  await evaluate(`Date.now = realNow; dispatchEvent(new Event('focus'));`);
  for (const [width, height, theme] of [[1920, 1080, 'light'], [1920, 1080, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await waitFor(`document.documentElement.scrollWidth <= innerWidth`);
    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(run, `${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
    if (width === 1920) assert.equal(await evaluate(`document.querySelector('.hackathon').getBoundingClientRect().bottom <= innerHeight`), true, `The TV shows the entire submission area: ${await evaluate(`document.querySelector('.hackathon').getBoundingClientRect().bottom`)}px`);
  }
  assert.equal(await evaluate('micAttempts'), 0);
  assert.deepEqual(await evaluate('checkErrors'), []);
  console.log('PASS hackathon: focused types, real deadline/ticking/cutoff, checklist persistence, draft review/edit/reload, brief changes, TV/phone light/dark; no host actions or microphone.');
  console.log(`Screenshots retained: ${run}`);
} finally {
  if (chrome.exitCode === null) { const exit = once(chrome, 'exit'); chrome.kill('SIGTERM'); await exit; }
  chrome.stderr.destroy(); chrome.stdio[3].destroy(); chrome.stdio[4].destroy();
  await vite.close();
  server.closeAllConnections();
  await new Promise(accept => server.close(accept));
}
