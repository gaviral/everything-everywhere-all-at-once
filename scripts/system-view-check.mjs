// Real keyless core traffic, plus explicitly synthetic model bursts for visual coverage.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPage, ready } from './headless.mjs';

if (ready()) { console.log(`SKIP system-view-check: ${ready()}`); process.exit(3); }
const root = resolve(new URL('..', import.meta.url).pathname);
const dist = join(root, 'ui/dist');
const binary = join(root, 'core/target/debug/e2a2o-core');
assert.ok(existsSync(binary), 'build the real core first');
const data = mkdtempSync(join(tmpdir(), 'system-view-check-'));
let page, app;
const streams = new Set();
let opens = 0, sequence = 0, feedAvailable = true;
const snapshot = { functions: [], branches: [], files: 0, warnings: [] };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/code-canvas/snapshot') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(snapshot)); return; }
  if (path === '/code-canvas/events') {
    if (!feedAvailable) { res.writeHead(404).end(); return; }
    opens++; streams.add(res); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n');
    res.on('close', () => streams.delete(res)); return;
  }
  const file = resolve(dist, path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(`${dist}/`) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
function emit(messages, missed = 0) {
  const batch = { sequence: ++sequence, observed_at: Date.now(), messages, missed };
  for (const response of streams) response.write(`data: ${JSON.stringify(batch)}\n\n`);
}
async function check(expression, label) { assert.ok(await page.until(expression, 10000), label); }
const click = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function screenshot(name) {
  if (!process.env.SYSTEM_VIEW_SCREEN_DIR) return;
  mkdirSync(process.env.SYSTEM_VIEW_SCREEN_DIR, { recursive: true });
  const image = await page.page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.env.SYSTEM_VIEW_SCREEN_DIR, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function waitFor(condition, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.fail(label);
}
async function freePort() {
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve)); return port;
}

async function visualChecks(base) {
  page = await openPage(`${base}/?canvas=code`, { width: 1920, height: 1300 });
  await check(`document.querySelector('.system-view button')?.getAttribute('aria-checked') === 'false'`, 'off by default');
  assert.equal(opens, 0, 'disabled view creates no observer');
  await page.evaluate(`navigator.mediaDevices.getUserMedia = () => { throw new Error('microphone must stay off'); }`);
  await click('.system-view button');
  await check(`document.querySelector('.sv-status')?.textContent.includes('waiting for real messages')`, 'quiet connected state');
  assert.equal(streams.size, 1);
  assert.equal(await page.evaluate(`document.querySelectorAll('.sv-flight').length`), 0, 'no invented idle traffic');
  assert.equal(await page.evaluate(`document.querySelectorAll('.sv-node').length`), 10, 'all real pieces visible');
  emit([{ from: 'core', to: 'placer', label: 'started', count: 12 }, { from: 'refiner', to: 'core', label: 'completed', count: 3 }]);
  await check(`document.querySelectorAll('.sv-flight').length === 2 && document.querySelector('.sv-recent').textContent.includes('×12')`, 'batched dots and compact counts');
  assert.ok(await page.evaluate(`document.querySelector('.sv-flight animateMotion').getAttribute('path').startsWith('M')`), 'dot travels on a real connection');
  await page.evaluate(`window.firstDot = document.querySelector('.sv-flight').getCTM();`);
  await check(`(() => { const next=document.querySelector('.sv-flight')?.getCTM(); return next && Math.hypot(next.e-firstDot.e,next.f-firstDot.f)>5; })()`, 'packet visibly changes position');
  await page.evaluate(`document.querySelector('.system-view').scrollIntoView({block:'start'})`);
  await screenshot('desktop-synthetic');
  await click('.sv-status button');
  await check(`document.querySelector('.sv-status').textContent.includes('Paused') && document.querySelectorAll('.sv-flight').length === 0`, 'pause removes moving messages');
  await waitFor(() => streams.size === 0, 'pause closes observer');
  assert.ok(await page.evaluate(`document.querySelector('.sv-recent').textContent.includes('×12')`), 'pause retains last observed state');
  await page.page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click('.sv-status button');
  await check(`document.querySelector('.sv-status').textContent.includes('waiting for real messages')`, 'resume reconnects');
  emit([{ from: 'core', to: 'flow', label: 'started', count: 2 }], 4);
  await check(`document.querySelector('.sv-recent').textContent.includes('Flow') && document.querySelector('.sv-gap').textContent.includes('4 events missed')`, 'reduced motion retains event names and gaps');
  assert.equal(await page.evaluate(`document.querySelectorAll('animateMotion').length`), 0, 'reduced motion has no moving dots');
  for (const response of streams) response.end();
  await check(`document.querySelector('.sv-status').textContent.includes('Disconnected')`, 'connection failure is visible');
  await check(`document.querySelector('.sv-status').textContent.includes('waiting for real messages')`, 'native event stream reconnects');
  assert.equal(await page.evaluate(`document.querySelectorAll('.sv-flight').length`), 0, 'reconnect never replays old traffic');
  await page.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));`);
  await check(`document.querySelector('.sv-status').textContent.includes('Hidden')`, 'background tab stops observing');
  await waitFor(() => streams.size === 0, 'hidden tab releases observer');
  await page.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));`);
  await check(`document.querySelector('.sv-status').textContent.includes('waiting for real messages')`, 'visible tab observes only new messages');
  emit([{ from: 'core', to: 'placer', label: 'private payload', count: 1 }]);
  await check(`document.querySelector('.sv-status').textContent.includes('Unsupported event')`, 'unknown payload rejected');
  assert.ok(!await page.evaluate(`document.querySelector('.system-view').textContent.includes('private payload')`), 'unknown strings never reach the screen');
  emit([{ from: 'core', to: 'flow', label: 'started', count: 2 }]);
  await check(`document.querySelector('.sv-status').textContent.includes('Live · core events')`, 'valid metadata recovers');
  await page.page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await check(`document.documentElement.scrollWidth <= innerWidth`, 'phone keeps page within viewport');
  assert.ok(await page.evaluate(`document.querySelector('.sv-diagram-scroll').scrollWidth > document.querySelector('.sv-diagram-scroll').clientWidth`), 'narrow diagram stays legible in a scroll region');
  await page.evaluate(`document.querySelector('.sv-diagram-scroll').focus(); window.beforePan=document.querySelector('.sv-diagram-scroll').scrollLeft;`);
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await check(`document.querySelector('.sv-diagram-scroll').scrollLeft > beforePan`, 'keyboard pans the narrow diagram');
  await screenshot('phone-synthetic');
  await page.page('Emulation.setDeviceMetricsOverride', { width: 960, height: 650, deviceScaleFactor: 1, mobile: false });
  await check(`document.documentElement.scrollWidth <= innerWidth`, '200 percent equivalent viewport retains controls');
  await page.evaluate(`document.querySelector('.system-view button').focus()`);
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await check(`document.querySelector('.system-view button').getAttribute('aria-checked') === 'false' && !document.querySelector('.sv-diagram')`, 'keyboard turns observer off');
  await waitFor(() => streams.size === 0, 'off releases observer');
  feedAvailable = false;
  await click('.system-view button');
  await check(`document.querySelector('.sv-status').textContent.includes('Core stream unavailable')`, 'refused stream does not claim an automatic reconnect');
  assert.equal(streams.size, 0, 'refused stream has no observer');
  assert.equal(await page.evaluate(`document.querySelectorAll('.sv-flight').length`), 0, 'unavailable stream invents no messages');
  await click('.system-view button');
  await page.close(); page = undefined;
}

async function realCoreChecks() {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn(binary, [], { cwd: data, env: { ...process.env, PORT: String(port), MODEL_API_KEY: '', E2A2O_DATA: data, E2A2O_UI: dist, E2A2O_CODE_CANVAS: '1', E2A2O_TRACE: '0', ROOM: '', PUBLIC_URL: '' }, stdio: 'ignore' });
  await waitFor(async () => { try { return (await fetch(`${base}/room`)).ok; } catch { return false; } }, 'real core starts');
  page = await openPage(`${base}/?canvas=code`, { width: 1920, height: 1300 });
  await check(`!!document.querySelector('.system-view button')`, 'real core page loads');
  await click('.system-view button');
  await check(`document.querySelector('.sv-status').textContent.includes('waiting for real messages')`, 'real event stream connects');
  await page.evaluate(`window.probe = new WebSocket(location.origin.replace('http','ws')+'/ws'); new Promise((resolve,reject) => { probe.onopen=resolve; probe.onerror=reject; });`);
  await page.evaluate(`probe.send(JSON.stringify({type:'text',id:${JSON.stringify(randomUUID())},text:'A synthetic thought for the connection check.'}))`);
  await check(`document.querySelector('.sv-recent').textContent.includes('text frame') && document.querySelector('.sv-recent').textContent.includes('map change')`, 'real text frame and real core change appear');
  assert.ok(!await page.evaluate(`document.querySelector('.system-view').textContent.includes('A synthetic thought')`), 'message contents never enter display');
  await page.evaluate(`probe.send(JSON.stringify({type:'stay',thread_id:null}))`);
  await check(`document.querySelector('.sv-recent').textContent.includes('transaction saved')`, 'actual successful journal transaction appears');
  await page.evaluate(`document.querySelector('.system-view').scrollIntoView({block:'start'})`);
  await screenshot('desktop-real-keyless-core');
  await page.evaluate(`probe.close()`);
  assert.ok(readFileSync(join(data, 'journal.jsonl'), 'utf8').includes('stay_changed'), 'journal evidence exists on disk');
}

try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  await visualChecks(`http://127.0.0.1:${server.address().port}`);
  await realCoreChecks();
  console.log('PASS system-view: real keyless core frames/changes/journal, synthetic batched model dots, off/pause cleanup, reconnect, gaps, reduced motion, keyboard, phone/enlarged layout; microphone never started');
} finally {
  await page?.close();
  for (const response of streams) response.end();
  await new Promise(resolve => server.close(resolve));
  if (app && app.exitCode === null) { const ended = once(app, 'exit'); app.kill('SIGTERM'); await ended; }
}
