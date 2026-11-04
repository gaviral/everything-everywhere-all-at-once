// Explicit synthetic observer. Does not access the application or microphone.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from '../../ui/node_modules/vite/dist/node/index.js';
import react from '../../ui/node_modules/@vitejs/plugin-react/dist/index.js';

if (!process.argv.includes('--opt-in')) {
  console.log('OFF: pass --opt-in to run the synthetic shared-drawing observer.');
} else {
  await observe();
}

async function observe() {
  const evidence = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'shared-drawing-evidence-'));
  mkdirSync(evidence, { recursive: true });
  const server = await createServer({ configFile: false, root: new URL('../../ui', import.meta.url).pathname,
    plugins: [react()], cacheDir: mkdtempSync(join(tmpdir(), 'shared-drawing-vite-')),
    server: { host: '127.0.0.1', port: 0, hmr: false, ws: false, watch: null },
  });
  let browser;
  try {
    await checkContract(server);
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(![4360, 4399].includes(address.port));
    browser = await openBrowser(`http://127.0.0.1:${address.port}/src/intake1422/shared-drawing/preview.html`);
    await checkVisible(browser, evidence);
    console.log(`PASS shared drawing: contract, destination isolation, ordered receipts, reconnect, correction/undo, navigation, disable, pointer/touch, desktop/phone. Screenshots: ${evidence}`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function checkContract(server) {
  const base = '/src/intake1422/shared-drawing/';
  const { PreviewSessionHost } = await server.ssrLoadModule(base + 'PreviewSessionHost.ts');
  const { SketchSessionAdapter } = await server.ssrLoadModule(base + 'SketchSessionAdapter.ts');
  const { PointerStroke } = await server.ssrLoadModule(base + 'PointerStroke.ts');
  const { visibleStrokes } = await server.ssrLoadModule(base + 'StrokeProjection.ts');
  const { drawingFeature } = await server.ssrLoadModule(base + 'DrawingFeature.ts');
  assert.equal(drawingFeature.defaultEnabled, false);
  const host = new PreviewSessionHost([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
  const port = host.port({ id: 'source', label: 'Source' });
  const a = host.port({ id: 'a', label: 'A' });
  const b = host.port({ id: 'b', label: 'B' });
  let id = 0;
  const adapter = new SketchSessionAdapter(port, () => `test-${++id}`);
  adapter.select('a'); adapter.draw([[1, 2]]);
  assert.equal(port.snapshot('a').entries.length, 0, 'Fresh feature is off');
  a.setEnabled(true); b.setEnabled(true); adapter.setEnabled(true); adapter.select('a');
  const original = [[10, 20], [100, 200]];
  adapter.draw(original); original[0][0] = 999;
  assert.deepEqual(a.snapshot('a').entries[0].operation.points, [[10, 20], [100, 200]]);
  assert.equal(b.snapshot('b').entries.length, 0);
  const first = adapter.snapshot.entries[0].operation;
  port.submit(first);
  assert.equal(adapter.snapshot.entries.length, 1, 'Duplicate ID is accepted only once');
  assert.throws(() => port.submit({ ...first, points: [[8, 9]] }));
  assert.throws(() => port.submit({ ...first, id: 'forged', authorId: 'b' }));
  assert.throws(() => port.submit({ ...first, id: 'malformed', points: [[NaN, 8]] }));
  host.setConnected('a', false);
  adapter.draw([[200, 200]]); adapter.draw([[300, 300]], true); adapter.undo();
  assert.equal(adapter.snapshot.entries.filter(entry => !entry.acknowledged).length, 3);
  assert.equal(a.snapshot('a').entries.length, 1, 'Disconnected target does not accept pending strokes');
  adapter.setEnabled(false); host.setConnected('a', true);
  assert.equal(a.snapshot('a').entries.length, 1, 'Disabling suspends pending delivery');
  adapter.setEnabled(true);
  assert.equal(adapter.snapshot.entries.filter(entry => entry.acknowledged).length, 4);
  assert.deepEqual(a.snapshot('a').entries.map(entry => entry.operation.id), adapter.snapshot.entries.map(entry => entry.operation.id));
  for (let reconnect = 0; reconnect < 3; reconnect++) { host.setConnected('a', false); host.setConnected('a', true); }
  assert.equal(a.snapshot('a').entries.length, 4);
  assert.equal(visibleStrokes(adapter.snapshot.entries).length, 1);
  assert.equal(adapter.snapshot.entries.filter(entry => entry.operation.kind === 'stroke').length, 3, 'Corrections preserve original points');
  adapter.select('b'); adapter.draw([[50, 50]]); adapter.select('a');
  assert.equal(adapter.snapshot.entries.length, 4); assert.equal(b.snapshot('b').entries.length, 1);
  const pointer = new PointerStroke();
  assert.ok(pointer.begin(1, [1, 1])); assert.equal(pointer.begin(2, [2, 2]), false);
  assert.equal(pointer.end(2), undefined); pointer.cancel(); assert.equal(pointer.end(1), undefined);
  const limited = new SketchSessionAdapter(port, () => `bound-${++id}`);
  limited.setEnabled(true); limited.select('b');
  limited.draw(Array.from({ length: 2048 }, () => [0, 0]));
  assert.match(limited.notice, /full/);
  assert.equal(b.snapshot('b').entries.length, 1);
  limited.dispose(); adapter.dispose();
  const unavailable = new SketchSessionAdapter({ ...port, snapshot: sessionId => {
    if (sessionId === 'b') throw new Error('Session unavailable');
    return port.snapshot(sessionId);
  } });
  unavailable.setEnabled(true); unavailable.select('a');
  assert.equal(unavailable.snapshot.entries.length, 4);
  unavailable.select('b');
  assert.equal(unavailable.snapshot.entries.length, 0, 'A failed new session read never shows the previous session drawing');
  assert.match(unavailable.notice, /unavailable/);
  unavailable.dispose();
  const failedEnable = new SketchSessionAdapter({ ...port, subscribe: () => { throw new Error('Subscription unavailable'); } });
  failedEnable.setEnabled(true); assert.equal(failedEnable.enabled, false);
  assert.throws(() => port.submit({ ...first, id: 'disabled-after-failure' }));
  failedEnable.dispose();
  console.log('PASS contract: canonical IDs, immutable originals, bounds, forged/malformed input, ordered reconnect, off switch and pointer cancellation');
}

async function openBrowser(url) {
  const executable = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executable, 'Chrome is required for the visible check');
  const profile = mkdtempSync(join(tmpdir(), 'shared-drawing-browser-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--use-mock-keychain', '--password-store=basic', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Observer browser PID ${child.pid}; temporary profile retained at ${profile}`);
  let socket;
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
  process.once('exit', stop);
  const close = async () => {
    socket?.close();
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
    stop(); await exited;
    child.stderr.destroy(); child.unref(); process.removeListener('exit', stop);
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Browser did not announce DevTools')), 15000);
      child.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Browser exited during startup')); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const waiting = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const pending = waiting.get(message.id); if (pending) { waiting.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); } };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => { const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
    const until = async expression => {
      const end = Date.now() + 7000;
      while (Date.now() < end) {
        if (await evaluate(expression)) return;
        await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
      }
      assert.fail(`Visible condition did not arrive: ${expression}`);
    };
    await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    await until("!!document.querySelector('.shared-drawing')");
    return { page, evaluate, until, close };
  } catch (error) { await close(); throw error; }
}

async function checkVisible({ page, evaluate, until }, evidence) {
  const click = async text => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(text)}); button.click(); })()`);
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  };
  const status = text => until(`document.querySelector('[role=status]').textContent.includes(${JSON.stringify(text)})`);
  const selectDestination = id => evaluate(`(() => { const destination = document.querySelector('select'); destination.value=${JSON.stringify(id)}; destination.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  const targetIds = selector => evaluate(`JSON.stringify([...document.querySelectorAll('${selector} .sd-target-ids code')].map(node => node.textContent))`);
  const boardA = '[aria-label="Explanation board"]';
  const boardB = '[aria-label="Second session"]';
  const shot = async name => { const result = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(evidence, name + '.png'), Buffer.from(result.data, 'base64')); };
  assert.equal(await evaluate("document.querySelector('.sd-switch input').checked"), false);
  assert.equal(await evaluate("document.querySelector('select').disabled"), true);
  await evaluate("document.querySelector('.sd-switch input').click()");
  await selectDestination('board-a');
  await status('Connected');
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until('document.documentElement.scrollWidth <= innerWidth');
  await evaluate("document.querySelector('.sd-input').scrollIntoView({block:'center'})");
  const rect = await evaluate("document.querySelector('.sd-input').getBoundingClientRect().toJSON()");
  await page('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 30, y: rect.y + 30 }] });
  await page('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + 110, y: rect.y + 70 }] });
  await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await status('1 acknowledged');
  await click('Add example box'); await status('2 acknowledged');
  const ids = JSON.parse(await targetIds(boardA));
  assert.deepEqual(ids, ['mark-001', 'mark-002']);
  assert.deepEqual(JSON.parse(await targetIds(boardB)), []);
  const editorMarks = await evaluate("[...document.querySelectorAll('.sd-input [data-stroke-id]')].map(el => [el.dataset.strokeId, el.getAttribute('points') || el.getAttribute('cx')])");
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${boardA} .sd-paper [data-stroke-id]')].map(el => [el.dataset.strokeId, el.getAttribute('points') || el.getAttribute('cx')])`), editorMarks);
  await evaluate('window.scrollTo(0,0)'); await shot('shared-drawing-phone');
  await click('Disconnect explanation board'); await click('Add example box'); await status('1 pending');
  assert.equal(JSON.parse(await targetIds(boardA)).length, 2);
  await click('Reconnect explanation board'); await status('3 acknowledged');
  await click('Disconnect explanation board'); await click('Reconnect explanation board'); await status('3 acknowledged');
  assert.equal(JSON.parse(await targetIds(boardA)).length, 3);
  const originalsBefore = await evaluate("[...document.querySelectorAll('.sd-history [data-stroke-id]')].map(el=>el.getAttribute('points'))");
  await click('Correct last stroke'); await click('Add example box'); await status('4 acknowledged');
  assert.equal(await evaluate("document.querySelectorAll('.sd-input [data-stroke-id]').length"), 3);
  await click('Undo last stroke'); await status('5 acknowledged');
  assert.equal(await evaluate("document.querySelectorAll('.sd-input [data-stroke-id]').length"), 2);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.sd-history [data-stroke-id]')].slice(0,3).map(el=>el.getAttribute('points'))"), originalsBefore);
  await click('Jump to session notes'); await until("!document.querySelector('.shared-drawing')");
  await click('Return to drawing'); await status('5 acknowledged');
  assert.equal(await evaluate("document.querySelector('select').value"), 'board-a');
  await evaluate("document.querySelector('.sd-switch input').click()"); await status('off');
  assert.equal(await evaluate("document.querySelector('.sd-surface').disabled"), true);
  assert.equal(await evaluate("document.querySelectorAll('.sd-history [data-stroke-id]').length"), 4);
  await evaluate("document.querySelector('.sd-switch input').click()"); await status('5 acknowledged');
  await page('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.sd-input').scrollIntoView({block:'center'})");
  const desktop = await evaluate("document.querySelector('.sd-input').getBoundingClientRect().toJSON()");
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: desktop.x + 30, y: desktop.y + 30, button: 'left', clickCount: 1 });
  await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: desktop.x + 80, y: desktop.y + 80, button: 'left', buttons: 1 });
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: desktop.x + 90, y: desktop.y + 90, button: 'left', clickCount: 1 });
  await status('6 acknowledged');
  await selectDestination('board-b');
  await status('0 acknowledged'); await click('Add example box'); await status('1 acknowledged');
  assert.equal(JSON.parse(await targetIds(boardA)).length, 6);
  assert.deepEqual(JSON.parse(await targetIds(boardB)), ['mark-007']);
  await selectDestination('board-a');
  await status('6 acknowledged');
  await evaluate("document.querySelector('.sd-history').open=true; document.querySelector('.sd-receipt details').open=true; window.scrollTo(0,0)");
  await shot('shared-drawing-desktop');
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until('document.documentElement.scrollWidth <= innerWidth');
  await evaluate("document.documentElement.style.fontSize='200%'");
  await until('document.documentElement.scrollWidth <= innerWidth');
  assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.shared-drawing')).fontSize) >= 32"), 'The whole drawing view respects enlarged text');
  await shot('shared-drawing-large-text');
}
