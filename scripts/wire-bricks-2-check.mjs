// Visible Features integration with a synthetic core and a separate media-denied browser.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { standInCore } from "./headless.mjs";
const artifacts = mkdtempSync(join(tmpdir(), "wire-bricks-2-check-"));
const ids = ["demo-parts", "live-area", "pen-devices", "reload-session", "sketch-labels", "worktree-map", "dependency-sequences", "machine-demo", "native-receipts", "populated-variants", "research-walkthrough"];
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


const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], questions: [] };
const server = await standInCore(() => [{ type: "snapshot", world }]);
const browser = await chromePage();
try {
  const { page, evaluate, waitFor, screenshot, click } = browser;
  await page("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const id of ids) {
    await page("Page.navigate", { url: `http://127.0.0.1:${server.port}/bricks.html?brick=${id}&sample=empty` });
    await waitFor(() => !!document.querySelector('[class$="-example"]'));
    await waitFor(() => !document.querySelector('.brick-loading'));
    const state = await evaluate(id => {
      const panel = document.querySelector(`.${id}-example`);
      return { text: panel?.innerText ?? "", size: panel ? parseFloat(getComputedStyle(panel).fontSize) : 0, overflow: panel ? panel.scrollWidth - panel.clientWidth : -1, broke: document.querySelector('.brick-broke')?.textContent ?? "" };
    }, id);
    assert.equal(state.broke, "", `${id} renders without a feature error`);
    assert.ok(state.text.length > 100, `${id} has useful visible example content`);
    assert.ok(state.size >= 20, `${id} uses TV-sized base text`);
    assert.ok(await evaluate(id => [...document.querySelector(`.${id}-example`).querySelectorAll('p,li,dt,dd,label,button,summary')].filter(node => node.getBoundingClientRect().height && node.textContent.trim()).every(node => parseFloat(getComputedStyle(node).fontSize) >= 20), id), `${id} keeps visible text legible on TV`);
    assert.ok(state.overflow <= 2, `${id} fits the TV panel`);
    if (id === "research-walkthrough") {
      await evaluate(() => { const choice = document.querySelector('.research-walkthrough-example select'); choice.value = 'Workshop'; choice.dispatchEvent(new Event('change', { bubbles: true })); });
      await click("Open research note");
      await click("Try Canvas");
      await waitFor(() => document.querySelector('.research-walkthrough-example')?.textContent.includes('Demonstration: Canvas'));
      await evaluate(() => { const choice = document.querySelector('.research-walkthrough-example select'); choice.value = 'Garden'; choice.dispatchEvent(new Event('change', { bubbles: true })); });
      await click("Resume demonstration");
      await waitFor(() => document.querySelector('.research-walkthrough-example h2')?.textContent === 'Cards · Workshop');
      assert.equal(await evaluate(() => document.querySelector('.research-walkthrough-example select').value), 'Workshop', 'research return restores the visible filter');
    }
    if (id === "reload-session") {
      await evaluate(() => document.querySelector('.reload-session-example textarea').focus());
      await page("Input.insertText", { text: "Keep the garden draft" });
      await click("Move garden right");
      await click("Simulate rebuild");
      await waitFor(() => document.querySelector('.reload-session-example [role="status"]').textContent.includes('Rebuilding'));
      await click("Deliver rebuilt view");
      await page("Page.reload");
      await waitFor(() => document.querySelector('.reload-session-example textarea')?.value.includes('Keep the garden draft'));
      assert.ok(await evaluate(() => document.querySelector('.reload-session-example').textContent.includes('Garden place: 40')), 'reload restores the visible place');
    }
    await screenshot(`${id}-tv`);
    await page("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await evaluate(id => { const p = document.querySelector(`.${id}-example`); return p.scrollWidth <= p.clientWidth + 2; }, id), `${id} fits a narrow panel`);
    if (["worktree-map", "reload-session", "research-walkthrough"].includes(id)) await screenshot(`${id}-phone`);
    await evaluate(id => { document.querySelector(`.${id}-example`).style.fontSize = '36px'; }, id);
    assert.ok(await evaluate(id => { const panel = document.querySelector(`.${id}-example`); return panel.scrollWidth <= panel.clientWidth + 2; }, id), `${id} wraps enlarged text`);
    if (id === "research-walkthrough") await screenshot(`${id}-enlarged`);
    await evaluate(id => { document.querySelector(`.${id}-example`).style.fontSize = ''; }, id);
    assert.equal(await evaluate(() => window.__sideEffects.capture), 0, `${id} never requests media`);
    await page("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  }
  await page("Page.navigate", { url: `http://127.0.0.1:${server.port}/?shell=2` });
  await waitFor(() => !!document.querySelector('[data-guide="catalog"]'));
  await evaluate(() => document.querySelector('button[data-guide="catalog"]').click());
  await waitFor(() => !!document.querySelector('[data-row="demo-parts"]'));
  const catalog = await evaluate(ids => ids.map(id => {
    const row = document.querySelector(`[data-row="${id}"]`);
    return { id, visible: !!row && !!row.querySelector('[role="switch"]')?.getAttribute('aria-label'), on: row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') };
  }), ids);
  assert.equal(catalog.length, ids.length);
  for (const row of catalog) { assert.equal(row.visible, true, `${row.id} is listed in Features`); assert.equal(row.on, "false", `${row.id} starts off`); }
  await screenshot("features-tv");
  // Open one feature through its actual catalog control, then return using its own Features action.
  await evaluate(() => document.querySelector('[data-row="research-walkthrough"] [role="switch"]').click());
  await evaluate(() => document.querySelector('button[data-guide="catalog"]')?.click());
  await waitFor(() => !!document.querySelector('.research-walkthrough-example'));
  await evaluate(() => document.querySelector('.research-walkthrough-example button').click());
  await waitFor(() => !!document.querySelector('[data-row="research-walkthrough"]'));
  assert.deepEqual(browser.errors, [], "no uncaught browser exceptions");
  writeFileSync(join(artifacts, "result.json"), JSON.stringify({ ids, catalog, mediaRequests: 0, screenshots: ids.map(id => `${id}-tv.png`) }, null, 2));
  console.log(`PASS wire-bricks-2: eleven visible examples, TV/320px layouts, Features listing/defaults/return, no media; ${artifacts}`);
} finally { await browser.close(); server.close(); }
