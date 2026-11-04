// Visible behavior with synthetic source/branch responses. Rust tests exercise real files and git.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { openPage, ready } from './headless.mjs';
if (ready()) { console.log(`SKIP code-canvas-check: ${ready()}`); process.exit(3); }
const fn = (name, line, calls = [], reasons = []) => ({ id: `core/src/pieces.rs:${line}:${name}`, name, file: 'core/src/pieces.rs', line, end_line: line + 2, lines: 3, branches: 0, calls, unresolved: 0, reasons });
const leaf = fn('one_job', 9), root = fn('orchestrate', 1, [leaf.id]);
const branch = (name, parent, state) => ({ name, parent, state, tip: 'a1234567', fork: parent ? 'b1234567' : null, current: false, ahead: parent ? 1 : 0, behind: 0 });
let data = { functions: [root, leaf], branches: [branch('main', null, 'main'), branch('dev/pieces', 'main', 'dev'), branch('staging/pieces', 'dev/pieces', 'staging')], files: 1, warnings: [] };
let fail = false;
const dist = resolve(new URL('../ui/dist', import.meta.url).pathname);
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/code-canvas/snapshot') { res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(data)); return; }
  const file = resolve(dist, path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(`${dist}/`) || !existsSync(file)) { res.writeHead(404).end(); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let page;
try {
  page = await openPage(`http://127.0.0.1:${server.address().port}/?canvas=code`, { width: 1920, height: 1080 });
  assert.ok(await page.until(`document.querySelector('.cc-live')?.textContent.includes('2 functions')`), 'source counts render');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.cc-header')).backgroundColor`), 'rgba(0, 0, 0, 0)', 'dark canvas header stays legible under the light app theme');
  assert.ok(await page.evaluate(`(() => { const box=document.querySelector('.cc-branch-scroll').getBoundingClientRect(); const root=[...document.querySelectorAll('.cc-branch')].find(n=>n.querySelector('.cc-branch-name')?.textContent==='main').getBoundingClientRect(); return root.top>=box.top && root.bottom<=box.bottom && root.bottom<=innerHeight; })()`), 'main root is visible at the bottom of the initial branch view');
  await page.evaluate(`document.querySelector('.cc-piece > summary').click(); document.querySelector('.cc-piece .cc-piece > summary').click();`);
  assert.ok(await page.until(`document.querySelector('.cc-function-head')?.textContent.includes('orchestrate')`), 'open folder and file to functions');
  await page.evaluate(`document.querySelector('.cc-function-head').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-function-body')?.textContent.includes('one_job')`), 'function expands to its actual callee');
  assert.ok(await page.evaluate(`document.querySelector('.cc-function-head').getAttribute('aria-expanded') === 'true'`));
  const ancestry = await page.evaluate(`(() => { const nodes = [...document.querySelectorAll('.cc-branch-node')]; const dev = nodes.find(n => n.querySelector(':scope > .cc-branch')?.textContent.includes('dev/pieces')); return dev.querySelector(':scope > ul')?.textContent.includes('staging/pieces'); })()`);
  assert.ok(ancestry, 'branch grows above its named parent');
  const added = fn('new_piece', 20, [], ['90 lines (over 60)']); added.lines = 90; added.end_line = 109;
  data = { ...data, functions: [...data.functions, added], branches: [...data.branches, branch('dev/new', 'main', 'dev')] };
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-live')?.textContent.includes('3 functions') && document.querySelector('.cc-branch-tree')?.textContent.includes('dev/new')`), 'new functions and local branches arrive on read');
  assert.ok(await page.evaluate(`document.querySelector('.cc-function-head').getAttribute('aria-expanded') === 'true'`), 'refresh preserves open composition');
  await page.evaluate(`document.querySelectorAll('.cc-tabs button')[1].click()`);
  assert.ok(await page.until(`document.querySelector('.cc-split')?.textContent.includes('90 lines (over 60)')`), 'measured split signal is visible');
  fail = true;
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-live')?.textContent.includes('Showing last read')`), 'failed read identifies retained data');
  fail = false;
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`!document.querySelector('.cc-live').classList.contains('cc-stale')`), 'read recovers');
  await page.page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'phone has no horizontal overflow');
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.ok(await page.evaluate(`['A','BUTTON','INPUT','SELECT','SUMMARY'].includes(document.activeElement.tagName)`), 'keyboard reaches controls');
  console.log('PASS code-canvas: expand/collapse, calls, live source + branches, split signals, stale/recovery, keyboard, phone');
} finally { await page?.close(); await new Promise(r => server.close(r)); }
