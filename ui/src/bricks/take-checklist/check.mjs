// Focused check. Build the UI first; this uses only synthetic playground data.
// Its own browser profile and screenshots are retained, never deleted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitHash, readMapCheck } from './checks.ts';

const folder = dirname(fileURLToPath(import.meta.url));
const dist = resolve(folder, '../../../dist');
assert.ok(existsSync(join(dist, 'bricks.html')), 'Build the UI before the focused check');
const manifest = JSON.parse(readFileSync(join(folder, 'brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.id, 'take-checklist');
assert.equal(commitHash(' c331290f '), 'c331290f');
for (const invalid of ['', 'dev', '2026-11-04', 'c331290f-dirty', '/private/path']) assert.equal(commitHash(invalid), null);
const empty = { connected: true, threads: [], thoughts: [], suggestions: [], reminders: [], questions: [], notes: {}, positions: {}, partial: '' };
assert.equal(readMapCheck(empty).done, true);
assert.equal(readMapCheck({ ...empty, connected: false }).done, false);
for (const field of ['threads', 'thoughts', 'suggestions', 'reminders', 'questions', 'research', 'evidenceKept', 'choiceMaps', 'actionEstimates']) {
  assert.equal(readMapCheck({ ...empty, [field]: [{}] }).done, false, `${field} prevents an empty-map claim`);
}
assert.equal(readMapCheck({ ...empty, partial: 'a live phrase' }).done, false);
assert.equal(readMapCheck({ ...empty, positions: { old: {} } }).done, false);

const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert.ok(existsSync(chromePath), 'Chrome is required; set CHROME to its executable');
const artifacts = join(folder, '.check-artifacts');
mkdirSync(artifacts, { recursive: true });
const run = mkdtempSync(join(artifacts, 'run-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const requests = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, url: req.url });
  const path = resolve(dist, '.' + new URL(req.url, 'http://check').pathname);
  if (!path.startsWith(dist + '/') || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
assert.ok(![4360, 4399].includes(port));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(run, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--mute-audio', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const address = await new Promise((accept, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.once('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited before startup')); });
    chrome.stderr.on('data', chunk => {
      output += chunk.toString();
      const found = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) { clearTimeout(timer); accept(found[1]); }
    });
  });
  socket = new WebSocket(address);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    const task = pending.get(response.id);
    if (!task) return;
    pending.delete(response.id);
    clearTimeout(task.timer);
    if (response.error) task.reject(new Error(JSON.stringify(response.error)));
    else task.accept(response.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((accept, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { accept, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, message) => {
    const ok = await evaluate(`new Promise(resolve => {
      const end = performance.now() + 10000;
      const poll = () => { if (${expression}) resolve(true); else if (performance.now() >= end) resolve(false); else requestAnimationFrame(poll); };
      poll();
    })`);
    assert.ok(ok, message);
  };
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.checkErrors = []; window.micAttempts = 0;
    addEventListener('error', event => checkErrors.push(event.message));
    addEventListener('unhandledrejection', event => checkErrors.push(String(event.reason)));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { micAttempts++; return Promise.reject(new Error('Microphone forbidden in this check')); };
  ` });
  const go = async sample => {
    await page('Page.navigate', { url: `http://127.0.0.1:${port}/bricks.html?brick=take-checklist&sample=${sample}` });
    await waitFor(`document.querySelectorAll('.take-checklist-tile').length === 8`, 'All eight checks appear');
  };
  const click = async (selector) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const summaryIs = n => waitFor(`document.querySelector('.take-checklist-count').textContent === '${n}/8'`, `Summary shows ${n}/8`);
  const typeCommit = async value => {
    await evaluate(`(() => {
      const field = document.querySelector('.take-checklist-build-input input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await go('empty');
  await summaryIs(1);
  assert.match(await evaluate(`document.querySelector('.take-checklist').textContent`), /Page commit unavailable/);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm build commit"]').disabled`), true);
  await typeCommit('not-a-commit');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm build commit"]').disabled`), true);
  await typeCommit('c331290f');
  await waitFor(`!document.querySelector('[aria-label="Confirm build commit"]').disabled`, 'Valid manual commit can be confirmed');
  await click('[aria-label="Confirm build commit"]');
  await summaryIs(2);
  await evaluate(`document.querySelectorAll('button.take-checklist-tile').forEach(button => button.click())`);
  await summaryIs(8);
  assert.match(await evaluate(`document.querySelector('.take-checklist-progress').textContent`), /Checks complete/);
  assert.equal(await evaluate(`document.querySelector('.playground-log ol') === null`), true, 'Ticks send no host actions');
  await typeCommit('aabbccd');
  await summaryIs(7);
  await click('[aria-label="Confirm build commit"]');
  await summaryIs(8);
  await click('.playground-check input');
  await summaryIs(0);
  assert.match(await evaluate(`document.querySelector('.take-checklist').textContent`), /Waiting for the map/);
  await click('.playground-check input');
  await summaryIs(1);
  await click('button.take-checklist-tile');
  await summaryIs(2);
  await click('.take-checklist-controls button');
  await summaryIs(1);
  assert.match(await evaluate(`document.querySelector('.take-checklist-eyebrow').textContent`), /TAKE 02/);
  // Native keyboard interaction must tick and untick the focused manual check.
  await evaluate(`document.querySelector('button.take-checklist-tile').focus()`);
  for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await summaryIs(2);
  for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await summaryIs(1);
  await evaluate(`[...document.querySelectorAll('.playground-bar button')].find(button => button.textContent === 'Add a thought').click()`);
  await waitFor(`document.querySelector('.take-checklist-count').textContent === '0/8'`, 'A new thought removes the empty-map tick immediately');
  assert.match(await evaluate(`document.querySelectorAll('.take-checklist-tile')[1].textContent`), /Map needs attention/);
  await go('student-week');
  await summaryIs(0);
  for (const [width, height, scheme] of [[1920, 1080, 'light'], [1440, 1000, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await waitFor(`document.documentElement.scrollWidth <= innerWidth`, `${width}px has no horizontal overflow`);
    assert.equal(await evaluate(`document.querySelectorAll('.take-checklist-tile').length`), 8);
    if (width === 1920) {
      // The playground reserves 300px for its log. The checklist still fits the TV.
      assert.ok(await evaluate(`document.querySelector('.take-checklist').getBoundingClientRect().bottom < innerHeight`), 'The TV shows every item without scrolling');
    }
    const screenshot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(run, `${width}-${scheme}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  assert.equal(await evaluate('micAttempts'), 0);
  assert.deepEqual(await evaluate('checkErrors'), []);
  assert.ok(requests.every(request => request.method === 'GET'), 'No network mutation');
  console.log('PASS take-checklist: live map, manual build, ticks, reset, reconnect, keyboard, TV/phone, light/dark; no mic or sends.');
  console.log(`Screenshots and browser profile retained in ${run}`);
} finally {
  socket?.close();
  const stopped = chrome.exitCode !== null ? Promise.resolve() : once(chrome, 'exit');
  chrome.kill('SIGTERM');
  await stopped;
  server.closeAllConnections();
  await new Promise(accept => server.close(accept));
}
