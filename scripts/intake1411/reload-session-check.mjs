// Isolated acceptance: no app shell, supervisor, core, message sender or microphone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../ui/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), 'reload-session-check-'));
const identity = { mapId: 'garden', sessionId: 'sample', buildId: 'build-a' };
const previewPath = '/src/intake1411/reload-session/preview.html';

function fixture(createReloadSession, shared = new Map(), options = {}) {
  const listeners = new Set();
  const changes = new Set();
  const late = [];
  const activity = { writes: 0, draft: 0, view: 0, snapshots: 0, sends: 0, microphones: 0 };
  let draft = { text: '', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' };
  let view = { viewId: 'map', camera: { x: 0, y: 0, zoom: 1 } };
  const host = {
    readDraft: () => structuredClone(draft), readView: () => structuredClone(view),
    restoreDraft(value) { draft = structuredClone(value); activity.draft++; options.onRestore?.(); },
    restoreView(value) { view = structuredClone(value); activity.view++; },
    applySnapshot() { activity.snapshots++; },
    subscribeChanges(listener) { changes.add(listener); late.push(listener); return () => changes.delete(listener); },
    send() { activity.sends++; }, startMicrophone() { activity.microphones++; },
  };
  const storage = {
    getItem: key => { if (options.storageFails) throw Error('Storage unavailable'); return shared.get(key) ?? null; },
    setItem(key, value) { if (options.storageFails) throw Error('Storage unavailable'); activity.writes++; shared.set(key, value); },
  };
  const source = { subscribe(listener) {
    listeners.add(listener); late.push(() => listener({ type: 'snapshot', identity, revision: 'late', payload: {} }));
    return () => listeners.delete(listener);
  } };
  const recovery = createReloadSession({ identity: options.identity ?? identity, source, host, storage });
  const emit = (type, extra = {}) => {
    for (const listener of listeners) listener({ type, identity, ...extra });
  };
  return { recovery, emit, activity, shared, listeners, changes,
    draft: () => draft, view: () => view, late: () => late.forEach(callback => callback()),
    edit(text = 'Plan a small garden') {
      draft = { text, selectionStart: 5, selectionEnd: 12, selectionDirection: 'backward' };
      view = { viewId: 'outline', camera: { x: 80, y: -20, zoom: 1.5 } };
      changes.forEach(listener => listener());
    },
  };
}

function matchingSnapshot(f) { f.emit('snapshot', { revision: 'healthy-1', payload: {} }); }

function checkRestore(createReloadSession) {
  const first = fixture(createReloadSession);
  assert.equal(first.recovery.state.get().enabled, false);
  first.edit(); matchingSnapshot(first);
  assert.equal(first.activity.writes, 0, 'fresh switch must do no work');
  first.recovery.setEnabled(true); matchingSnapshot(first); first.edit();
  assert.equal(first.activity.writes, 1);
  const expected = { draft: first.draft(), view: first.view() };
  first.recovery.dispose();
  const next = fixture(createReloadSession, first.shared);
  next.recovery.setEnabled(true);
  next.emit('connected');
  assert.equal(next.recovery.state.get().phase, 'disconnected', 'connection alone is not readiness');
  for (const key of ['mapId', 'sessionId', 'buildId']) {
    next.emit('snapshot', { identity: { ...identity, [key]: 'wrong' }, revision: 'wrong', payload: {} });
    assert.equal(next.activity.snapshots, 0);
    assert.equal(next.activity.draft, 0);
    assert.equal(next.activity.view, 0);
  }
  matchingSnapshot(next);
  assert.deepEqual(next.draft(), expected.draft);
  assert.deepEqual(next.view(), expected.view);
  matchingSnapshot(next);
  assert.equal(next.activity.draft, 1, 'duplicate snapshots must not restore twice');
  assert.equal(next.activity.view, 1);
  assert.equal(next.activity.writes, 0, 'restoring must not rewrite saved user data');
  next.emit('build-start'); assert.equal(next.recovery.state.get().phase, 'rebuilding');
  next.emit('build-failed', { message: 'Synthetic compile error' });
  assert.equal(next.recovery.state.get().phase, 'failed');
  assert.deepEqual(next.view(), expected.view);
  assert.equal(next.recovery.state.get().revision, 'healthy-1');
  next.emit('connected'); assert.equal(next.recovery.state.get().phase, 'failed');
  matchingSnapshot(next); assert.equal(next.recovery.state.get().phase, 'ready');
  next.emit('disconnected'); next.edit('Keep newer disconnected text');
  matchingSnapshot(next);
  assert.equal(next.draft().text, 'Keep newer disconnected text', 'new edits win over recovery');
  next.recovery.setEnabled(false);
  const writes = next.activity.writes, saved = [...next.shared];
  next.edit(); next.late(); matchingSnapshot(next);
  assert.equal(next.activity.writes, writes);
  assert.deepEqual([...next.shared], saved, 'disable must preserve user data');
  assert.equal(next.listeners.size, 0); assert.equal(next.changes.size, 0);
  assert.equal(next.activity.sends, 0); assert.equal(next.activity.microphones, 0);
  next.recovery.setEnabled(true); matchingSnapshot(next);
  assert.equal(next.draft().text, 'Keep newer disconnected text');
  next.recovery.dispose();
}

function checkIsolation(createReloadSession) {
  const first = fixture(createReloadSession);
  first.recovery.setEnabled(true); matchingSnapshot(first); first.edit(); first.recovery.dispose();
  for (const key of ['mapId', 'sessionId', 'buildId']) {
    const otherIdentity = { ...identity, [key]: 'other' };
    const other = fixture(createReloadSession, first.shared, { identity: otherIdentity });
    other.recovery.setEnabled(true);
    other.emit('snapshot', { identity: otherIdentity, revision: 'other', payload: {} });
    assert.equal(other.activity.draft, 0); assert.equal(other.activity.view, 0);
    other.recovery.dispose();
  }
  const corrupt = new Map([...first.shared].map(([key]) => [key, '{invalid']));
  const bad = fixture(createReloadSession, corrupt);
  bad.recovery.setEnabled(true); matchingSnapshot(bad);
  assert.equal(bad.recovery.state.get().phase, 'ready');
  assert.equal(bad.recovery.state.get().checkpoint, 'unavailable');
  assert.equal(bad.activity.draft, 0); assert.equal(bad.activity.writes, 0);
  assert.equal([...corrupt.values()][0], '{invalid', 'unreadable data must be retained');
  bad.recovery.dispose();
  const unavailable = fixture(createReloadSession, new Map(), { storageFails: true });
  unavailable.recovery.setEnabled(true); matchingSnapshot(unavailable); unavailable.edit();
  assert.equal(unavailable.recovery.state.get().checkpoint, 'unavailable');
  assert.equal(unavailable.recovery.state.get().phase, 'ready');
  unavailable.recovery.dispose();
  let stop;
  const reentrant = fixture(createReloadSession, first.shared, { onRestore: () => stop() });
  stop = () => reentrant.recovery.setEnabled(false);
  reentrant.recovery.setEnabled(true); matchingSnapshot(reentrant);
  assert.equal(reentrant.activity.view, 0, 'disable inside a callback cancels the remaining restore');
  assert.equal(reentrant.recovery.state.get().enabled, false);
}

async function startPreview() {
  const server = await createServer({ configFile: false, root: join(root, 'ui'),
    cacheDir: join(artifacts, 'vite-cache'), appType: 'mpa',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, hmr: false, ws: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === 'object');
  assert.ok(![4360, 4399].includes(address.port));
  return { server, url: `http://127.0.0.1:${address.port}${previewPath}` };
}

async function openBrowser(url) {
  const executable = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!executable) throw Error('MISSING: Chrome for visible acceptance');
  const chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0',
    `--user-data-dir=${join(artifacts, 'chrome-profile')}`, '--no-first-run', '--no-default-browser-check',
    '--use-mock-keychain', '--password-store=basic', '--mute-audio', '--deny-permission-prompts', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`Owned Chrome PID ${chrome.pid}`);
  let socket;
  const close = async () => {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const ended = once(chrome, 'exit');
      chrome.kill('SIGTERM');
      await ended;
    }
    chrome.stderr.destroy();
    assert.ok(chrome.exitCode !== null || chrome.signalCode !== null, 'owned Chrome must stop');
  };
  try {
    const endpoint = await new Promise((accept, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
      chrome.once('exit', () => { clearTimeout(timeout); reject(Error('Chrome exited during startup')); });
      chrome.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timeout); accept(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await once(socket, 'open');
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      const listener = pending.get(response.id);
      if (listener) { pending.delete(response.id); response.error ? listener.reject(Error(response.error.message)) : listener.resolve(response.result); }
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    await cdp('Page.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__forbidden = { microphone: 0, sends: 0 };
      window.__reloadVisit = crypto.randomUUID();
      if (globalThis.MediaDevices) MediaDevices.prototype.getUserMedia = function() {
        window.__forbidden.microphone++; return Promise.reject(new Error('Microphone blocked by check'));
      };
      const originalSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function(...args) { window.__forbidden.sends++; return originalSend.apply(this, args); };
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        const method = init?.method || input?.method || 'GET';
        if (!['GET', 'HEAD'].includes(method.toUpperCase())) window.__forbidden.sends++;
        return originalFetch.call(this, input, init);
      };
    ` });
    const wait = async expression => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await evaluate(expression).catch(() => false)) return;
        await cdp('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(resolve))', awaitPromise: true });
      }
      throw Error(`TIMING: condition not reached: ${expression}`);
    };
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url });
    await wait('document.querySelector("#recovery-status")?.dataset.phase === "off"');
    return { cdp, evaluate, wait, close };
  } catch (error) { await close(); throw error; }
}

const el = id => `document.getElementById(${JSON.stringify(id)})`;
const phase = value => `${el('recovery-status')}.dataset.phase === ${JSON.stringify(value)}`;
async function click(page, id) { await page.evaluate(`${el(id)}.click()`); }
async function select(page, id, value) {
  await page.evaluate(`${el(id)}.value=${JSON.stringify(value)};${el(id)}.dispatchEvent(new Event('change',{bubbles:true}))`);
}
async function reloadPreview(page, expected) {
  const visit = await page.evaluate('window.__reloadVisit');
  await click(page, 'reload-page');
  await page.wait(`window.__reloadVisit !== ${JSON.stringify(visit)} && (${expected})`);
}
async function capture(page, name) {
  const shot = await page.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(artifacts, name), Buffer.from(shot.data, 'base64'));
}
async function assertNoOverflow(page) {
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'visible layout must fit');
}

async function checkVisible(url) {
  const page = await openBrowser(url);
  try {
    assert.equal(await page.evaluate(`${el('recovery-enabled')}.checked`), false);
    await click(page, 'recovery-enabled'); await page.wait(phase('ready'));
    await page.evaluate(`${el('unsent-draft')}.focus()`);
    await page.cdp('Input.insertText', { text: 'Plan a small garden' });
    await page.evaluate(`${el('unsent-draft')}.setSelectionRange(5,12,'backward');${el('unsent-draft')}.dispatchEvent(new Event('select'))`);
    await select(page, 'selected-view', 'outline');
    await click(page, 'pan-right'); await click(page, 'pan-right'); await click(page, 'zoom-in');
    const savedView = await page.evaluate(`${el('view-readout')}.textContent`);
    await reloadPreview(page, `${phase('ready')} && ${el('unsent-draft')}.value === 'Plan a small garden'`);
    assert.deepEqual(await page.evaluate(`(() => {const d=${el('unsent-draft')};return [d.selectionStart,d.selectionEnd,d.selectionDirection]})()`), [5, 12, 'backward']);
    assert.equal(await page.evaluate(`${el('view-readout')}.textContent`), savedView);
    const restores = await page.evaluate(`${el('recovery-metrics')}.textContent.split(' · ')[1].split(' ')[0]`);
    assert.equal(restores, '1');
    await click(page, 'matching-snapshot');
    assert.equal(await page.evaluate(`${el('recovery-metrics')}.textContent.split(' · ')[1].split(' ')[0]`), restores);
    await click(page, 'disconnect'); await page.wait(phase('disconnected'));
    await click(page, 'connect'); assert.equal(await page.evaluate(phase('disconnected')), true);
    for (const mismatch of ['mapId', 'sessionId', 'buildId']) {
      await select(page, 'snapshot-identity', mismatch); await click(page, 'emit-snapshot');
      assert.equal(await page.evaluate(phase('disconnected')), true);
      assert.equal(await page.evaluate(`${el('view-readout')}.textContent`), savedView);
    }
    await click(page, 'matching-snapshot'); await page.wait(phase('ready'));
    const healthyRevision = await page.evaluate(`${el('revision-readout')}.textContent`);
    await click(page, 'build-start'); await page.wait(phase('rebuilding'));
    await click(page, 'build-fail'); await page.wait(phase('failed'));
    assert.equal(await page.evaluate(`${el('view-readout')}.textContent`), savedView);
    assert.equal(await page.evaluate(`${el('revision-readout')}.textContent`), healthyRevision);
    assert.equal(await page.evaluate(`${el('unsent-draft')}.value`), 'Plan a small garden');
    await capture(page, 'desktop-build-error.png');
    await click(page, 'build-recover'); await page.wait(phase('ready'));
    await select(page, 'open-session', 'other'); await click(page, 'switch-session');
    await page.wait(`${phase('ready')} && new URL(location.href).searchParams.get('session') === 'other'`);
    assert.equal(await page.evaluate(`${el('unsent-draft')}.value`), '');
    assert.equal(await page.evaluate(`${el('selected-view')}.value`), 'map');
    await select(page, 'open-session', 'sample'); await click(page, 'switch-session');
    await page.wait(`${el('unsent-draft')}?.value === 'Plan a small garden'`);
    assert.equal(await page.evaluate(`${el('view-readout')}.textContent`), savedView);
    await click(page, 'recovery-enabled'); await page.wait(phase('off'));
    const stored = await page.evaluate('JSON.stringify(Object.entries(sessionStorage).sort())');
    await click(page, 'disconnect'); await click(page, 'build-start'); await click(page, 'build-recover');
    await page.evaluate(`${el('unsent-draft')}.focus()`);
    await page.cdp('Input.insertText', { text: 'off' });
    await click(page, 'pan-left');
    assert.equal(await page.evaluate('JSON.stringify(Object.entries(sessionStorage).sort())'), stored);
    await reloadPreview(page, phase('off'));
    assert.equal(await page.evaluate(`${el('unsent-draft')}.value`), '', 'off must not restore');
    await click(page, 'recovery-enabled'); await page.wait(`${el('unsent-draft')}.value === 'Plan a small garden'`);
    await page.evaluate(`${el('recovery-enabled')}.focus()`);
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await page.wait(phase('off'));
    await assertNoOverflow(page);
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
    await assertNoOverflow(page); await capture(page, 'phone.png');
    await page.evaluate(`document.querySelector('.reload-session-preview').style.fontSize='32px'`);
    await assertNoOverflow(page); await capture(page, 'phone-enlarged-text.png');
    assert.deepEqual(await page.evaluate('window.__forbidden'), { microphone: 0, sends: 0 });
    console.log('PASS visible: native reload, selection, view/camera, reconnect, identity rejection, build failure/recovery, off, keyboard, 320px and enlarged text');
  } finally { await page.close(); }
}

async function main() {
  const { server, url } = await startPreview();
  try {
    const { createReloadSession, reloadSessionFeature } = await server.ssrLoadModule('/src/intake1411/reload-session/index.ts');
    assert.equal(reloadSessionFeature.id, 'intake1411-reload-session');
    assert.equal(reloadSessionFeature.defaultEnabled, false);
    checkRestore(createReloadSession); checkIsolation(createReloadSession);
    console.log('PASS injected contracts: default off, exact identity, once-per-reconnect restore, disconnected edits, errors, late callbacks, preserved storage, no sends/mic');
    await checkVisible(url);
    console.log(`Artifacts retained: ${artifacts}`);
    console.log('MISSING: owner driver source-edit/restart integration; no supervisor or app-shell proof');
  } finally { await server.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
