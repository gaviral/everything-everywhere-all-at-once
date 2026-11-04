// Scoped browser acceptance. Synthetic host only; retained artifacts and owned process cleanup.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uiServer } from './ui-server.mjs';
import react from '../ui/node_modules/@vitejs/plugin-react/dist/index.js';

const server = await uiServer({ configFile: false, appType: 'spa', plugins: [react()] }, { port: 0 });
await server.listen();
const port = server.httpServer.address().port;
assert.ok(![4360, 4399].includes(port));
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/src/msg1351/research-walkthrough/preview.html`;
const stopServer = () => server.close();
if (process.argv.includes('--serve')) {
  console.log(`Scoped synthetic preview: ${url}`);
  const stop = async () => { await stopServer(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} else {
  const artifacts = mkdtempSync(join(tmpdir(), 'research-walkthrough-'));
  const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
  let child, socket;
  const errors = [], external = [], waiting = new Map();
  let sequence = 0;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (test, label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await test()) return; await pause(40); }
    throw Error(`TIMING: ${label} did not arrive`);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`TIMING: ${method}`)); }, 20000);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const visibleText = () => evaluate('document.body.innerText');
  const click = async text => {
    const point = await evaluate(`(() => {
      const e = [...document.querySelectorAll('button, summary, label')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
      if (!e) throw Error('Missing control');
      e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const has = async text => assert.ok((await visibleText()).includes(text), text);
  const waitText = text => until(async () => (await visibleText()).includes(text), text);
  const openNote = async () => { await click('Open research note'); await waitText('Why give thoughts a place?'); };
  const shot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  try {
    assert.ok(chrome, 'Chrome is required for visible acceptance');
    child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(artifacts, 'browser-profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
    const active = join(artifacts, 'browser-profile', 'DevToolsActivePort');
    await until(() => { if (child.exitCode !== null) throw Error('Chrome exited'); return existsSync(active); }, 'Chrome debug endpoint');
    const debugPort = Number(readFileSync(active, 'utf8').split('\n')[0]);
    assert.ok(![4360, 4399].includes(debugPort));
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = waiting.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); waiting.delete(message.id);
        if (message.error) pending.reject(Error(message.error.message)); else pending.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      else if (message.method === 'Network.requestWillBeSent') {
        const request = message.params.request.url;
        if (/^https?:/.test(request) && !request.startsWith(origin + '/')) external.push(request);
      }
    };
    await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.mediaAttempts=0; if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.mediaAttempts++;throw Error('Media forbidden in preview')};` });
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url });
    await waitText('Research walkthrough');
    assert.equal(await evaluate('document.querySelector("[role=switch]").getAttribute("aria-checked")'), 'false');
    assert.ok(!(await visibleText()).includes('Open research note'), 'off shows no evidence action');
    await click('Off'); await waitText('Open research note'); await openNote();
    await click('Source and limits'); await has('This studied a different document workspace.');
    const source = await evaluate('document.querySelector(".research-walkthrough a").href');
    assert.equal(source, 'https://www.microsoft.com/en-us/research/publication/data-mountain-using-spatial-memory-for-document-management/');
    await evaluate('document.querySelector(".research-walkthrough a").focus()');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate('document.activeElement.textContent'), 'Try Canvas', 'citation leads to feature action by keyboard');
    for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await evaluate('document.querySelector(".research-walkthrough").style.fontSize="200%"');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'no horizontal overflow at 200%');
      assert.ok(await evaluate('[...document.querySelectorAll(".research-walkthrough button, .research-walkthrough summary")].every(e=>e.getBoundingClientRect().height>=44)'), 'reachable touch targets');
      await shot(`${width}-${theme}`);
    }
    await click('Try Canvas'); await waitText('Demonstration: Canvas');
    assert.equal(await evaluate('document.querySelector("select").value'), 'All');
    await click('Preview conditions'); await click('Temporarily unmount panel');
    assert.equal(await evaluate('!!document.querySelector(".research-walkthrough")'), false);
    await click('Temporarily unmount panel'); await waitText('Demonstration: Canvas');
    await click('Back to explanation'); await waitText('Why give thoughts a place?');
    await click('Resume demonstration'); await waitText('Open research note');
    assert.equal(await evaluate('document.querySelector(".research-preview-demo").dataset.view'), 'Cards');
    assert.equal(await evaluate('document.querySelector("select").value'), 'Selected', 'jump-and-return restores visible filter');
    assert.equal(await evaluate('document.activeElement.textContent'), 'Open research note', 'focus returns to opener');
    await openNote(); await click('Feature unavailable'); await click('Try Canvas'); await waitText('This feature is unavailable.');
    await click('Feature unavailable'); await click('Try Canvas'); await waitText('Demonstration: Canvas');
    await click('Return temporarily unavailable'); await click('On'); await waitText('Your original demonstration is unavailable.');
    assert.equal(await evaluate('document.querySelector("[role=switch]").getAttribute("aria-checked")'), 'true', 'failed return keeps recovery controls');
    await click('Return temporarily unavailable'); await click('On');
    await until(() => evaluate('document.querySelector("[role=switch]").getAttribute("aria-checked")==="false"'), 'off after restoration');
    assert.equal(await evaluate('document.querySelector("select").value'), 'Selected', 'off restores original filter');
    await click('No verified evidence'); await click('Off'); await waitText('Verified evidence unavailable.');
    assert.equal(await evaluate('!![...document.querySelectorAll("button")].find(e=>e.textContent==="Open research note")'), false);
    await shot('unavailable');
    assert.deepEqual(external, [], 'no external source fetched at runtime');
    assert.deepEqual(errors, [], 'no browser exceptions');
    assert.equal(await evaluate('window.mediaAttempts'), 0, 'no microphone request');
    writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({ result: 'PASS', kind: 'scoped synthetic host in real Chrome', checks: ['default off', 'citation and limits', 'keyboard', 'Canvas navigation', 'filter and selection restoration', 'remount', 'failed feature', 'failed return retry', 'off restoration', 'unavailable evidence', '390/1280 light/dark at 200%', 'no external fetch', 'no media capture'], limitations: ['No integrated host adapter, main admission, live service or human film proof.'] }, null, 2));
    console.log(`PASS research-walkthrough: scoped browser acceptance; artifacts ${artifacts}`);
  } catch (error) {
    if (socket?.readyState === 1) { await shot('failure').catch(() => {}); writeFileSync(join(artifacts, 'failure.txt'), await visibleText().catch(() => 'Page unavailable')); }
    console.error(`Retained failure artifacts: ${artifacts}`);
    throw error;
  } finally {
    socket?.close();
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000);
      await exited; clearTimeout(force);
      assert.notEqual(child.exitCode ?? child.signalCode, null, 'owned Chrome stopped');
    }
    for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('Browser closed')); }
    await stopServer();
  }
}
