// Focused offline fixture: no server, microphone, model, real sender or shared browser.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(directory, '../../../..');
const { build } = await import(join(ui, 'node_modules/vite/dist/node/index.js'));
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--lib', 'ES2022,DOM,DOM.Iterable', '--types', 'vite/client', join(directory, 'index.tsx')], { cwd: ui, encoding: 'utf8' });
assert.equal(types.status, 0, types.stdout + types.stderr);
const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(directory, '../brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false); assert.equal(manifest.flag, 'placeholders');
const built = await build({ configFile: false, root: ui, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, build: { write: false, minify: false, lib: { entry: join(directory, 'index.tsx'), name: 'PlaceholderFixture', formats: ['iife'] } } });
const javascript = (Array.isArray(built) ? built : [built]).flatMap(result => result.output).find(item => item.type === 'chunk').code;
const artifacts = await mkdtemp(join(tmpdir(), 'placeholder-mode-'));
const browser = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${join(artifacts, 'profile')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--mute-audio', '--use-mock-keychain', '--password-store=basic', 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let serial = 0, buffered = '';
const pending = new Map();
browser.stdio[4].on('data', bytes => {
  buffered += bytes;
  for (let end; (end = buffered.indexOf('\0')) !== -1;) {
    const value = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1);
    const waiter = pending.get(value.id);
    if (waiter) { clearTimeout(waiter.timer); pending.delete(value.id); value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result); }
  }
});
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => reject(new Error(`TIMING: ${method}`)), 10000);
    pending.set(id, { resolve, reject, timer }); browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => call(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = condition => evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+6000;function check(){if(${condition})return resolve(true);if(performance.now()>deadline)return reject(new Error('TIMING: fixture condition'));requestAnimationFrame(check)}check()})`);
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1250, deviceScaleFactor: 1, mobile: false });
  await page('Page.setDocumentContent', { frameId: (await page('Page.getFrameTree')).frameTree.frame.id, html: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' });
  await evaluate(javascript);
  await until(`document.querySelector('#contact') && getComputedStyle(document.querySelector('#contact')).opacity==='0' && document.querySelector('.placeholder-mode-field-cover')`);
  const painted = () => evaluate(`[...document.querySelectorAll('[data-placeholder-mode-ui]')].map(e=>e.textContent).join(String.fromCharCode(10))`);
  assert.match(await painted(), /you@example\.com/);
  assert.match(await painted(), /\+1 \(555\) 010-0100/);
  assert.match(await painted(), /Message to Example recipient · dry run/);
  assert.doesNotMatch(await painted(), /alex\.morgan@example\.com|7946|Unlisted Recipient/);
  assert.equal(await evaluate(`document.querySelector('#date').textContent`), 'Meeting: 2026-11-04 · 42 items');
  assert.equal(await evaluate(`document.querySelector('#email').value`), 'alex.morgan@example.com');
  assert.equal(await evaluate(`document.querySelector('#contact a').getAttribute('href')`), 'mailto:alex.morgan@example.com');
  assert.equal(await evaluate(`document.querySelector('#contact a').title`), 'you@example.com');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#contact')).opacity`), '0');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#email')).webkitTextFillColor`), 'rgba(0, 0, 0, 0)');
  // Private names are configured without painting the entry, then replace whole words only.
  await evaluate(`document.querySelector('details').open=true;document.querySelector('#placeholder-mode-name').focus()`);
  await page('Input.insertText', { text: 'Alex Morgan' });
  await evaluate(`document.querySelector('.placeholder-mode-add button').click()`);
  await until(`getComputedStyle(document.querySelector('#person')).opacity==='0'`);
  assert.match(await painted(), /Person 1/);
  assert.doesNotMatch(await painted(), /Alex Morgan/);
  // A DOM selection is still original, and the real state reaches a synthetic send handler.
  await evaluate(`{const range=document.createRange();range.selectNodeContents(document.querySelector('#contact a'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.querySelector('#send').click()}`);
  assert.deepEqual(await evaluate('window.fixture.sent[0]'), { to: 'Unlisted Recipient', email: 'alex.morgan@example.com', edited: 'alex.morgan@example.com', selected: 'alex.morgan@example.com' });
  await evaluate(`document.querySelector('#email').focus();document.querySelector('#email').select()`);
  await page('Input.insertText', { text: 'new.person@example.com' });
  await until(`[...document.querySelectorAll('.placeholder-mode-field-cover')].some(e=>e.textContent==='you@example.com') && document.querySelector('#email').value==='new.person@example.com'`);
  await evaluate(`document.querySelector('#send').click()`);
  assert.equal(await evaluate('window.fixture.sent.at(-1).edited'), 'new.person@example.com');
  await evaluate(`document.querySelector('#update').click()`);
  await until(`document.querySelector('#contact a').textContent==='updated@example.com' && [...document.querySelectorAll('[data-placeholder-mode-ui]')].some(e=>e.textContent==='Message to Example recipient · dry run')`);
  assert.doesNotMatch(await painted(), /updated@example\.com|Different Recipient/);
  await writeFile(join(artifacts, 'desktop.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 1250, deviceScaleFactor: 1, mobile: true });
  await until(`document.querySelector('.placeholder-mode').getBoundingClientRect().right<=390`);
  await writeFile(join(artifacts, 'phone.png'), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`document.querySelector('#toggle').click()`);
  await until(`!document.querySelector('.placeholder-mode') && !document.querySelector('.placeholder-mode-hidden-text') && !document.querySelector('.placeholder-mode-field-cover')`);
  assert.equal(await evaluate(`document.querySelector('#contact a').title`), 'alex.morgan@example.com');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#contact')).opacity`), '1');
  assert.equal(await evaluate(`document.querySelector('#email').value`), 'new.person@example.com');
  await evaluate(`document.querySelector('#toggle').click()`);
  await until(`document.querySelector('.placeholder-mode-hidden-text')`);
  assert.equal(await evaluate(`document.querySelector('#person').textContent`), 'Alex Morgan');
  assert.equal(await evaluate(`document.querySelector('#person').classList.contains('placeholder-mode-hidden-text')`), false, 'names discarded on unmount');
  assert.deepEqual(await evaluate('window.fixture.errors'), []);
  assert.deepEqual(await evaluate('window.fixture.source'), { name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '+44 20 7946 0958', recipient: 'Unlisted Recipient' });
  console.log(`PASS placeholder-mode: focused types, example rendering, names, native edits, selection, original send payload, live replacement, off/on, desktop and phone. Screenshots: ${artifacts}`);
} finally {
  if (browser.exitCode === null) { const exited = once(browser, 'exit'); browser.kill('SIGTERM'); await exited; }
}
