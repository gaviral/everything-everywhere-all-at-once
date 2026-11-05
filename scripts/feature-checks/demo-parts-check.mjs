import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from '../../ui/node_modules/vite/dist/node/index.js';
import react from '../../ui/node_modules/@vitejs/plugin-react/dist/index.js';

// No shared host, core, jobs or user browser. All temporary artifacts are retained.
const uiRoot = fileURLToPath(new URL('../../ui/', import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), 'demo-parts-check-'));
const source = '/src/features/demo-parts/';

function checkReadiness({ candidateReadiness, resolveProof }, { syntheticSnapshot }) {
  const now = Date.now();
  const snapshot = syntheticSnapshot(now);
  const candidate = snapshot.candidates[0];
  const inspect = (value = snapshot, item = candidate) => candidateReadiness(item, value, now);
  assert.equal(inspect().available, false, 'synthetic evidence cannot claim live readiness');
  assert.deepEqual(inspect().proofs.map(proof => proof.state), ['demonstrated', 'demonstrated']);
  assert.deepEqual(inspect(snapshot, snapshot.candidates[1]).proofs.map(proof => proof.state), ['missing', 'missing']);
  const live = { ...snapshot, receipts: snapshot.receipts.map(receipt => ({ ...receipt, scope: 'live' })) };
  assert.equal(inspect(live).available, true, 'injected current live receipts can satisfy readiness');
  const changed = patch => ({ ...live, receipts: live.receipts.map(receipt => ({ ...receipt, ...patch })) });
  for (const [patch, state] of [
    [{ freshUntil: new Date(now - 1).toISOString() }, 'stale'],
    [{ state: 'stale' }, 'stale'],
    [{ state: 'disconnected' }, 'disconnected'],
    [{ state: 'missing' }, 'missing'],
    [{ buildId: 'another-build' }, 'stale'],
    [{ deviceId: 'another-device' }, 'stale'],
    [{ observedAt: undefined }, 'missing'],
    [{ observedAt: new Date(now + 1000).toISOString() }, 'missing'],
    [{ source: { label: 'Unsafe', href: 'javascript:alert(1)' } }, 'missing'],
    [{ source: { label: 'Unsafe', href: 'file:///private-proof' } }, 'missing'],
    [{ source: { label: 'Unsafe', href: `https://${['user', 'password'].join(':')}@example.test` } }, 'missing'],
  ]) {
    const result = inspect(changed(patch));
    assert.equal(result.available, false, `unavailable with ${JSON.stringify(patch)}`);
    assert.ok(result.proofs.every(proof => proof.state === state));
  }
  assert.equal(inspect({ ...live, connected: false }).available, false);
  assert.equal(inspect({ ...live, target: { buildId: '', deviceId: '' } }).available, false);
  assert.equal(inspect(live, { ...candidate, featureSwitch: { ...candidate.featureSwitch, enabled: false } }).available, false);
  assert.equal(inspect(live, { ...candidate, steps: [] }).available, false);
  assert.equal(inspect(live, { ...candidate, prerequisites: [] }).available, false);
  assert.equal(inspect(live, { ...candidate, prerequisites: candidate.prerequisites.filter(item => item.kind !== 'device') }).available, false);
  assert.equal(resolveProof(candidate.prerequisites[0], { ...live, receipts: [...live.receipts, live.receipts[0]] }, now).state, 'missing');
  assert.equal(resolveProof(candidate.prerequisites[0], changed({ kind: 'device' }), now).state, 'missing');
}

async function previewServer() {
  const entry = {
      name: 'isolated-demo-check',
      resolveId(id) { if (id === 'virtual:demo-check') return '\0demo-check'; },
      load(id) {
        if (id !== '\0demo-check') return;
        return `import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {SyntheticPreview} from '${source}SyntheticPreview.tsx';
          import {createSyntheticAdapter,syntheticSnapshot} from '${source}synthetic.ts';
          const fixture=createSyntheticAdapter();
          const control=window.__demo={fixture,syntheticSnapshot,reads:0,failSelection:false};
          for(const part of [fixture.adapter.catalog,fixture.adapter.selection]) {
            const get=part.getSnapshot;
            part.getSnapshot=()=>{control.reads++;return get()};
          }
          const save=fixture.adapter.selection.setSelected;
          fixture.adapter.selection.setSelected=(...args)=>{
            if(control.failSelection)throw new Error('Synthetic selection refusal');
            save(...args);
          };
          createRoot(document.getElementById('root')).render(React.createElement(SyntheticPreview,{adapter:fixture.adapter}));`;
      },
  };
  const compiled = await build({ root: uiRoot, configFile: false, plugins: [react(), entry], logLevel: 'error',
    build: { write: false, minify: false, cssCodeSplit: false, rollupOptions: { input: 'virtual:demo-check' } } });
  const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(result => result.output);
  const files = new Map();
  for (const file of output) {
    const content = file.type === 'chunk' ? file.code : file.source;
    files.set('/' + file.fileName, content);
    const target = join(artifacts, 'bundle', file.fileName);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  const script = output.find(file => file.type === 'chunk' && file.isEntry).fileName;
  const styles = output.filter(file => file.fileName.endsWith('.css')).map(file => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
  files.set('/__demo-check', `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated demo check</title><style>body{margin:0;background:#f6f7f1}</style>${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);
  const http = createHttpServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    const content = files.get(path);
    if (content === undefined) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(content);
  });
  const server = await createServer({
    root: uiRoot, configFile: false, plugins: [react()],
    cacheDir: join(artifacts, 'vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address();
  assert.ok(port !== 4360 && port !== 4399);
  return { server, url: `http://127.0.0.1:${port}/__demo-check`, async close() {
    http.closeAllConnections();
    await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    await server.close();
  } };
}

async function chromePage() {
  const chromePath = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(chromePath, 'Chrome is required for the visible acceptance check');
  const child = spawn(chromePath, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(artifacts, 'chrome-profile')}`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--mute-audio', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  writeFileSync(join(artifacts, 'chrome.pid'), `${child.pid}\n`);
  const errors = [];
  child.stderr.on('data', () => {});
  let sequence = 0, pending = Buffer.alloc(0);
  const requests = new Map();
  const closed = once(child, 'exit');
  function rejectPending(error) { for (const request of requests.values()) { clearTimeout(request.timeout); request.reject(error); } requests.clear(); }
  child.on('error', rejectPending);
  child.once('exit', () => rejectPending(new Error('Owned Chrome exited')));
  child.stdio[4].on('data', data => {
    pending = Buffer.concat([pending, data]);
    let delimiter;
    while ((delimiter = pending.indexOf(0)) !== -1) {
      const message = JSON.parse(pending.subarray(0, delimiter).toString());
      pending = pending.subarray(delimiter + 1);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      const request = requests.get(message.id);
      if (!request) continue;
      requests.delete(message.id); clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
      requests.set(id, { resolve, reject, timeout });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }
  async function close() {
    if (child.exitCode !== null) return;
    const watchdog = setTimeout(() => { if (child.exitCode === null) process.kill(child.pid, 'SIGTERM'); }, 5000);
    await send('Browser.close').catch(() => {});
    await closed;
    clearTimeout(watchdog);
    child.stderr.destroy();
    child.stdio[3].destroy(); child.stdio[4].destroy();
    assert.equal(child.exitCode, 0, 'owned browser closed cleanly');
  }
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    await page('Page.enable'); await page('Runtime.enable');
    for (const name of ['microphone', 'camera']) await send('Browser.setPermission', { permission: { name }, setting: 'denied' });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__sideEffects={capture:0,network:0};window.__attempts=[];
      const denied=kind=>function(...args){window.__sideEffects[kind]++;window.__attempts.push({kind,args:args.map(value=>{try{const url=new URL(String(value));url.search='';return url.href}catch{return String(value)}})});throw new Error('Side effect forbidden in candidate preview')};
      if(navigator.mediaDevices)for(const method of ['getUserMedia','getDisplayMedia'])Object.defineProperty(navigator.mediaDevices,method,{value:denied('capture')});
      window.MediaRecorder=denied('capture');
      window.fetch=denied('network');window.WebSocket=denied('network');window.EventSource=denied('network');window.Worker=denied('network');
      XMLHttpRequest.prototype.open=denied('network');navigator.sendBeacon=denied('network');
      window.__deadlines=new Map();
      const schedule=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window);
      window.setTimeout=(callback,delay,...args)=>{const id=schedule(()=>{window.__deadlines.delete(id);callback(...args)},delay);window.__deadlines.set(id,delay);return id};
      window.clearTimeout=id=>{window.__deadlines.delete(id);cancel(id)};
    ` });
    async function evaluate(fn, arg) {
      const result = await page('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`, awaitPromise: true, returnByValue: true, userGesture: true });
      assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
      return result.result.value;
    }
    async function waitFor(predicate) {
      return evaluate(async expression => {
        const predicate = (0, eval)(`(${expression})`);
        await new Promise((resolve, reject) => {
          let frame;
          const timeout = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('Visible condition timed out: ' + expression)); }, 12_000);
          const inspect = () => { if (predicate()) { clearTimeout(timeout); resolve(); } else frame = requestAnimationFrame(inspect); };
          inspect();
        });
      }, predicate.toString());
    }
    async function key(key, { code = key, modifiers = 0, text } = {}) {
      const characters = text ?? (key === 'Enter' ? '\r' : undefined);
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(characters ? { text: characters } : {}), windowsVirtualKeyCode: { Enter: 13, Tab: 9, ' ': 32 }[key] });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    }
    async function click(label) {
      const point = await evaluate(label => {
        const button = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
        if (!button) throw new Error('Missing button: ' + label);
        button.scrollIntoView({ block: 'center' });
        const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, label);
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    async function screenshot(name) {
      const { cssContentSize } = await page('Page.getLayoutMetrics');
      const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
      writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
    }
    return { page, evaluate, waitFor, key, click, screenshot, errors, close };
  } catch (error) { await close(); throw error; }
}

async function checkVisible(browser, url) {
  const { page, evaluate, waitFor, key, click, screenshot } = browser;
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page('Page.navigate', { url });
  await waitFor(() => document.querySelector('button')?.textContent === 'Enable demo candidates');
  assert.deepEqual(await evaluate(() => ({ reads: window.__demo.reads, subscriptions: window.__demo.fixture.subscribers(), catalog: !!document.querySelector('[aria-label="Demo candidates"]') })), { reads: 0, subscriptions: 0, catalog: false }, 'fresh profile is off without adapter work');
  await key('Tab');
  assert.equal(await evaluate(() => document.activeElement.textContent), 'Enable demo candidates');
  await key('Enter');
  await waitFor(() => document.querySelectorAll('.dp-card').length === 2);
  assert.equal(await evaluate(() => window.__demo.fixture.subscribers()), 2);
  await key('Tab');
  assert.equal(await evaluate(() => document.activeElement.textContent), 'Inspect Review a travel plan');
  await key('Enter');
  await waitFor(() => document.activeElement.tagName === 'H2');
  assert.equal(await evaluate(() => document.querySelectorAll('.dp-step').length), 2);
  assert.ok(await evaluate(() => document.body.innerText.includes('Two proposed routes remain visible.')));
  assert.ok(await evaluate(() => document.body.innerText.includes('Synthetic receipt')));
  assert.ok(await evaluate(() => document.body.innerText.includes('Live demonstration unavailable')));
  await key('Tab');
  assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Select Review a travel plan');
  await key(' ', { code: 'Space', text: ' ' });
  await waitFor(() => document.querySelector('.dp-selection button').getAttribute('aria-pressed') === 'true');
  await key('Tab', { modifiers: 8 });
  assert.equal(await evaluate(() => document.activeElement.textContent), 'Back to candidates');
  await key('Enter');
  await waitFor(() => document.querySelectorAll('.dp-card').length === 2);
  assert.equal(await evaluate(() => document.activeElement.textContent), 'Inspect Review a travel plan', 'return restores the inspect control');
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('.dp-card button[aria-pressed]')].map(button => button.getAttribute('aria-pressed'))), ['true', 'false']);
  await screenshot('desktop-catalog');

  await click('Inspect Resume a shared sketch');
  await waitFor(() => document.querySelectorAll('.dp-missing').length === 2);
  assert.ok(await evaluate(() => document.querySelector('[aria-label="Readiness gaps"]').textContent.includes('Reload continuity: No receipt supplied.')));
  assert.ok(await evaluate(() => document.querySelector('[aria-label="Readiness gaps"]').textContent.includes('Target device: No receipt supplied.')));
  assert.equal(await evaluate(() => document.querySelector('.dp-readiness').textContent), 'Live demonstration unavailable');
  await page('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
  await waitFor(() => document.documentElement.clientWidth === 320);
  assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px content fits without horizontal scrolling');
  assert.ok(await evaluate(() => [...document.querySelectorAll('button')].every(button => button.getBoundingClientRect().height >= 44)), 'controls remain touch-sized');
  await screenshot('narrow-missing-proof');
  await evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await waitFor(() => getComputedStyle(document.documentElement).fontSize === '32px');
  assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'enlarged text fits narrow screen');
  await screenshot('narrow-enlarged-text');
  await click('Select Resume a shared sketch');
  await click('Back to candidates');
  await waitFor(() => document.querySelectorAll('.dp-card').length === 2);
  await click('Deselect Review a travel plan');
  await waitFor(() => document.querySelector('.dp-summary').textContent.includes('Selected: Resume a shared sketch.'));
  assert.equal(await evaluate(() => document.querySelectorAll('.dp-card').length), 2, 'deselection keeps both alternatives');

  await click('Disable demo candidates');
  await waitFor(() => !document.querySelector('[aria-label="Demo candidates"]'));
  assert.equal(await evaluate(() => window.__demo.fixture.subscribers()), 0, 'disabled view unsubscribes');
  assert.equal(await evaluate(() => [...window.__deadlines.values()].filter(delay => delay > 60_000).length), 0, 'disabled view cancels proof deadlines');
  await evaluate(() => { window.__demo.readsWhenDisabled = window.__demo.reads; window.__demo.fixture.updateCatalog(window.__demo.syntheticSnapshot()); });
  assert.equal(await evaluate(() => window.__demo.reads), await evaluate(() => window.__demo.readsWhenDisabled), 'disabled view does not read catalog updates');
  await click('Enable demo candidates');
  await waitFor(() => document.querySelectorAll('.dp-card').length === 2);
  assert.equal(await evaluate(() => document.querySelectorAll('button[aria-pressed="true"]').length), 2, 're-enabled view retains its selected candidate');
  await click('Deselect Resume a shared sketch');
  await waitFor(() => document.querySelector('.dp-summary').textContent.startsWith('No candidates selected.'));
  assert.equal(await evaluate(() => document.querySelectorAll('.dp-card').length), 2);

  await evaluate(() => { window.__demo.failSelection = true; });
  await click('Select Review a travel plan');
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('could not be saved'));
  assert.deepEqual(await evaluate(() => window.__demo.fixture.adapter.selection.getSnapshot()), []);
  await evaluate(() => { window.__demo.failSelection = false; });
  await click('Select Review a travel plan');
  await waitFor(() => !document.querySelector('[role="alert"]'));
  await evaluate(() => {
    const snapshot = window.__demo.fixture.adapter.catalog.getSnapshot();
    window.__demo.fixture.updateCatalog({ ...snapshot, candidates: snapshot.candidates.filter(candidate => candidate.id !== 'plan') });
  });
  await waitFor(() => document.querySelectorAll('.dp-card').length === 1);
  assert.ok(await evaluate(() => document.querySelector('.dp-summary').textContent.includes('Unavailable candidate (choice retained)')));
  await evaluate(() => window.__demo.fixture.updateCatalog(window.__demo.syntheticSnapshot()));
  await waitFor(() => document.querySelectorAll('.dp-card').length === 2);
  assert.equal(await evaluate(() => document.querySelector('[aria-label="Deselect Review a travel plan"]').getAttribute('aria-pressed')), 'true');

  await evaluate(() => { document.documentElement.style.fontSize = ''; });
  await click('Inspect Review a travel plan');
  await waitFor(() => document.activeElement.tagName === 'H2');
  await evaluate(() => {
    const snapshot = window.__demo.fixture.adapter.catalog.getSnapshot();
    window.__demo.fixture.updateCatalog({ ...snapshot, candidates: snapshot.candidates.filter(candidate => candidate.id !== 'plan') });
  });
  await waitFor(() => document.querySelectorAll('.dp-card').length === 1);
  assert.equal(await evaluate(() => document.activeElement.textContent), 'Inspect Resume a shared sketch', 'a removed open candidate returns focus to an available alternative');
  await evaluate(() => window.__demo.fixture.updateCatalog(window.__demo.syntheticSnapshot()));
  await waitFor(() => document.querySelectorAll('.dp-card').length === 2);
  assert.equal(await evaluate(() => !!document.querySelector('[aria-label="Candidate preview"]')), false, 'a returning descriptor does not reopen itself');
  await click('Inspect Review a travel plan');
  await waitFor(() => document.querySelectorAll('.dp-demonstrated').length === 2);
  await evaluate(() => {
    const snapshot = window.__demo.fixture.adapter.catalog.getSnapshot();
    window.__demo.fixture.updateCatalog({ ...snapshot, connected: false });
  });
  await waitFor(() => document.querySelectorAll('.dp-disconnected').length === 2);
  await evaluate(() => {
    const snapshot = window.__demo.syntheticSnapshot();
    window.__demo.fixture.updateCatalog({ ...snapshot, receipts: snapshot.receipts.map(receipt => ({ ...receipt, scope: 'live', freshUntil: new Date(Date.now() + 2000).toISOString() })) });
  });
  await waitFor(() => document.querySelector('.dp-readiness')?.textContent === 'Live demonstration available');
  await waitFor(() => document.querySelectorAll('.dp-stale').length === 2);
  assert.equal(await evaluate(() => document.querySelector('.dp-readiness').textContent), 'Live demonstration unavailable', 'deadline alone expires proof without a catalog event');
  assert.deepEqual(await evaluate(() => window.__sideEffects), { capture: 0, network: 0 }, 'no media or network operation requested by preview');
  assert.deepEqual(browser.errors, [], 'browser has no uncaught errors');
  await click('Disable demo candidates');
  await waitFor(() => window.__demo.fixture.subscribers() === 0);
}

let preview, browser;
try {
  preview = await previewServer();
  checkReadiness(await preview.server.ssrLoadModule(`${source}readiness.ts`), await preview.server.ssrLoadModule(`${source}synthetic.ts`));
  browser = await chromePage();
  await checkVisible(browser, preview.url);
  console.log('PASS demo-parts: catalog, steps, selection/return/deselection, missing/stale/disconnected proof, disable/restore, keyboard, 320px and enlarged text; no capture/network requests');
  console.log(`Artifacts: ${artifacts}`);
} catch (error) {
  if (browser) {
    await browser.screenshot('failure').catch(() => {});
    const state = await browser.evaluate(() => ({ text: document.body.innerText, active: document.activeElement?.outerHTML, sideEffects: window.__sideEffects, attempts: window.__attempts, reads: window.__demo?.reads })).catch(() => null);
    writeFileSync(join(artifacts, 'failure.json'), JSON.stringify({ state, errors: browser.errors }, null, 2));
  }
  console.error(`REAL demo-parts-check: ${error.stack ?? error}`);
  console.error(`Artifacts: ${artifacts}`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally { await preview?.close(); }
}
