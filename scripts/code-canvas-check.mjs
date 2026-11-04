// Visible behavior with synthetic source/branch responses. Rust tests exercise real files and git.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { openPage, ready } from './headless.mjs';
if (ready()) { console.log(`SKIP code-canvas-check: ${ready()}`); process.exit(3); }
const fn = (name, line, calls = [], reasons = []) => ({ id: `core/src/pieces.rs:${line}:${name}`, name, file: 'core/src/pieces.rs', line, end_line: line + 2, lines: 3, branches: 0, calls, unresolved: 0, reasons });
const leaf = fn('one_job', 9), root = fn('orchestrate', 1, [leaf.id]);
const branch = (name, parent, state) => ({ name, parent, state, tip: 'a1234567', fork: parent ? 'b1234567' : null, current: false, ahead: parent ? 1 : 0, behind: 0 });
let data = { functions: [root, leaf], branches: [branch('main', null, 'main'), branch('dev/pieces', 'main', 'dev'), branch('staging/pieces', 'dev/pieces', 'staging')], files: 1, warnings: [] };
data.branches.splice(1, 0, branch('staging', 'main', 'staging'), branch('dev', 'staging', 'dev'));
data.parts = [root, leaf].map(f => ({ id: f.id, name: f.name, file: f.file, line: f.line, tags: ['function', 'mechanism'], version: 3, version_scope: 'file history' }));
data.parts.push({ id: 'core/src/prompt.rs', name: 'prompt.rs', file: 'core/src/prompt.rs', line: 1, tags: ['prompt', 'data'], version: 2, version_scope: 'file history' });
data.agents = { available: true, updated_at: new Date().toISOString(), lanes: [{ id: 'dev/pieces', branch: 'dev/pieces', who: 'Worker', now: 'Checking the new parts view', finished: ['Built the source reader', 'Added the branch columns'], state: 'Working', updated_at: new Date().toISOString() }], needs_you: [{ id: 'ask-route', title: 'Choose the next route', detail: 'Should the agent build search or tags next?', lane: 'dev/pieces' }], summary: ['Two lanes are ready for review.'], notice: '' };
let fail = false, failAnswer = false;
const answers = [];
async function screenshot(name) {
  if (!process.env.CODE_CANVAS_SCREEN_DIR) return;
  mkdirSync(process.env.CODE_CANVAS_SCREEN_DIR, { recursive: true });
  const capture = await page.page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(process.env.CODE_CANVAS_SCREEN_DIR, name + '.png'), Buffer.from(capture.data, 'base64'));
}
const dist = resolve(new URL('../ui/dist', import.meta.url).pathname);
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/code-canvas/answer') {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      if (failAnswer) { res.writeHead(503).end(); return; }
      const answer = JSON.parse(body); answers.push(answer);
      data = { ...data, agents: { ...data.agents, needs_you: data.agents.needs_you.filter(n => n.id !== answer.id) } };
      res.writeHead(204).end();
    }); return;
  }
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
  assert.ok(await page.evaluate(`(() => { const names=['main','staging','dev','dev/pieces']; const boxes=names.map(name=>[...document.querySelectorAll('[data-branch]')].find(n=>n.dataset.branch===name).getBoundingClientRect()); return boxes.every((b,i)=>!i||b.left>boxes[i-1].left); })()`), 'main, staging, dev, lanes appear left to right');
  assert.ok(await page.until(`document.querySelector('.cc-branches').textContent.includes('Worker') && document.querySelector('.cc-agent').textContent.includes('Checking the new parts view')`), 'agent identity and current task are visible');
  await page.evaluate(`document.querySelector('.cc-agent details').open=true`);
  assert.ok(await page.evaluate(`document.querySelector('.cc-agent').textContent.includes('Built the source reader')`), 'finished work remains visible on expansion');
  assert.ok(await page.evaluate(`document.querySelector('.cc-needs').textContent.includes('Choose the next route')`), 'waiting request stays at bottom right');
  await screenshot('desktop-synthetic');
  await page.page('Emulation.setDeviceMetricsOverride', { width: 3840, height: 2160, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`document.querySelector('.cc-header-actions button').click()`);
  assert.ok(await page.until(`document.querySelector('.code-canvas').classList.contains('cc-tv')`), 'TV size is explicitly available');
  await screenshot('tv-synthetic');
  await page.evaluate(`document.querySelector('.cc-header-actions button').click()`);
  await page.page('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`document.querySelector('.cc-piece > summary').click(); document.querySelector('.cc-piece .cc-piece > summary').click();`);
  assert.ok(await page.until(`document.querySelector('.cc-function-head')?.textContent.includes('orchestrate')`), 'open folder and file to functions');
  await page.evaluate(`document.querySelector('.cc-function-head').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-function-body')?.textContent.includes('one_job')`), 'function expands to its actual callee');
  assert.ok(await page.evaluate(`document.querySelector('.cc-function-head').getAttribute('aria-expanded') === 'true'`));
  assert.ok(await page.evaluate(`document.querySelector('.cc-part-labels').textContent.includes('v3')`), 'part version and tags are visible');
  await page.evaluate(`[...document.querySelectorAll('.cc-tag-filter button')].find(b=>b.textContent==='prompt').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-file-parts')?.textContent.includes('prompt.rs') && document.querySelectorAll('.cc-function').length===0`), 'prompt filter includes file parts without a function');
  await page.evaluate(`document.querySelector('.cc-tag-filter button').click()`);
  await page.evaluate(`document.querySelector('.cc-piece > summary').click(); document.querySelector('.cc-piece .cc-piece > summary').click(); document.querySelector('.cc-function-head').click()`);
  const added = fn('new_piece', 20, [], ['90 lines (over 60)']); added.lines = 90; added.end_line = 109;
  data = { ...data, functions: [...data.functions, added], branches: [...data.branches, branch('aaa-new', 'main', 'dev')] };
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-live')?.textContent.includes('3 functions') && document.querySelector('.cc-branch-board')?.textContent.includes('aaa-new')`), 'new functions and local branches arrive on read');
  assert.ok(await page.evaluate(`(() => { const names=[...document.querySelectorAll('.cc-lanes [data-branch]')].map(n=>n.dataset.branch); return names.indexOf('aaa-new')>names.indexOf('dev/pieces'); })()`), 'new lane appends without moving existing slots');
  assert.ok(await page.evaluate(`document.querySelector('.cc-function-head').getAttribute('aria-expanded') === 'true'`), 'refresh preserves open composition');
  await page.evaluate(`document.querySelectorAll('.cc-tabs button')[1].click()`);
  assert.ok(await page.until(`document.querySelector('.cc-split')?.textContent.includes('90 lines (over 60)')`), 'measured split signal is visible');
  data = { ...data, branches: data.branches.map(b => b.name === 'dev/pieces' ? { ...b, merged_into: 'dev', joined_at: 'cafe1234' } : b) };
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-merge-moments').textContent.includes('dev/pieces joined dev')`), 'a live merge has a visible moment');
  assert.ok(await page.evaluate(`document.querySelector('.cc-lanes').textContent.includes('dev/pieces')`), 'recently joined lane stays visible under active filter');
  assert.ok(await page.until(`document.querySelector('.cc-merge-lines > path') !== null`), 'line rises to the integration that received the lane');
  await screenshot('merge-synthetic');
  data = { ...data, agents: { available: false, updated_at: '', lanes: [], needs_you: [], summary: [], notice: 'Agent feed unavailable' } };
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-warning')?.textContent.includes('Agent feed unavailable')`), 'agent-feed failure is visible');
  assert.ok(await page.evaluate(`document.querySelector('.cc-needs').textContent.includes('Choose the next route')`), 'feed failure retains waiting cards');
  data.agents = { available: true, updated_at: new Date().toISOString(), lanes: [], needs_you: [{ id: 'ask-route', title: 'Choose the next route', detail: 'Search or tags?', lane: '' }], summary: [], notice: '' };
  fail = true;
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-live')?.textContent.includes('Showing last read')`), 'failed read identifies retained data');
  fail = false;
  await page.evaluate(`document.querySelector('.cc-live button').click()`);
  assert.ok(await page.until(`!document.querySelector('.cc-live').classList.contains('cc-stale')`), 'read recovers');
  failAnswer = true;
  await page.evaluate(`const area=document.querySelector('.cc-need textarea'); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(area,'Build tags next'); area.dispatchEvent(new Event('input',{bubbles:true}));`);
  await page.evaluate(`document.querySelector('.cc-need form button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-need form').textContent.includes('not saved')`), 'failed save keeps card and draft');
  assert.equal(await page.evaluate(`document.querySelector('.cc-need textarea').value`), 'Build tags next');
  failAnswer = false;
  await page.evaluate(`document.querySelector('.cc-need form button').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-needs').textContent.includes('Answer saved')`), 'answer receipt is visible');
  assert.equal(answers[0].answer, 'Build tags next');
  await page.page('Page.reload');
  assert.ok(await page.until(`document.querySelector('.cc-needs').textContent.includes('Nothing waiting')`), 'answered card stays gone after reload');
  await page.page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.ok(await page.until(`document.querySelector('.cc-needs-toggle').getAttribute('aria-expanded') === 'false'`), 'phone starts with a compact persistent request bar');
  await screenshot('phone-synthetic');
  await page.evaluate(`document.querySelector('.cc-needs-toggle').click()`);
  assert.ok(await page.until(`document.querySelector('.cc-needs-sheet').open`), 'phone request bar opens a modal sheet');
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.ok(await page.until(`!document.querySelector('.cc-needs-sheet').open && document.activeElement === document.querySelector('.cc-needs-toggle')`), 'Escape closes the sheet and returns focus');
  data = { ...data, agents: { available: false, updated_at: '', lanes: [], needs_you: [], summary: [], notice: 'Agent feed unavailable' } };
  await page.page('Page.reload');
  assert.ok(await page.until(`document.querySelector('.cc-needs-toggle strong').textContent==='?'`), 'unknown feed never claims there are zero requests');

  assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'phone has no horizontal overflow');
  await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.ok(await page.evaluate(`['A','BUTTON','INPUT','SELECT','SUMMARY'].includes(document.activeElement.tagName)`), 'keyboard reaches controls');
  console.log('PASS code-canvas: ordered branches, agent work, merge moment/lines, tags/versions, durable answers + failure, expansion, stale/recovery, keyboard, phone');
} finally { await page?.close(); await new Promise(r => server.close(r)); }
