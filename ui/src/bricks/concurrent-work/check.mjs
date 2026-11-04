import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const ui = resolve(directory, '../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'concurrent-work-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json')));
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.id, 'concurrent-work');
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--resolveJsonModule', '--allowSyntheticDefaultImports', '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(directory, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: directory, plugins: [react()], logLevel: 'warn', build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(directory, 'preview.html') } } });
let requests = [];
let refuse = false;
const server = createServer(async (req, res) => {
  if (req.url === '/helper-result') {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (refuse) { res.writeHead(403).end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ base: 'test-base', status: 'completed', exit_code: 0, validation: 'not_run', no_change: false, truncated: true,
      files: [{ path: 'return.ts', additions: 1, deletions: 0, binary: false, withheld: false, truncated: false, diff: '+ returnToCapture();\n+ <img src=x onerror=alert(1)>\n' + '+ example\n'.repeat(80) }] })); return;
  }
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(artifacts, 'built', path === '/' ? 'preview.html' : `.${path}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { res.writeHead(404).end(); return; }
  try { res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4387, '127.0.0.1', resolve); });
let browser;
try {
  browser = await openPage('http://127.0.0.1:4387', { width: 1600, height: 1100, preserveProfile: true });
  const { page, evaluate, until } = browser;
  const errors = [];
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await page('Runtime.enable');
  const wait = async (expression, message) => assert.ok(await until(expression), message);
  const click = async (selector, text) => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`);
  const fixture = async name => evaluate(`(()=>{const el=document.querySelector('#fixture');el.value=${JSON.stringify(name)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const body = `document.querySelector('.concurrent-work')?.textContent`;
  const result = `document.querySelector('.cw-result')?.textContent`;
  await wait(`${body}?.includes('Interactive example')`, 'empty map opens with labelled example');
  await wait(`${result}?.includes('Start with one thought')`, 'example has readable output');
  assert.equal(await evaluate(`document.querySelector('.cw-return').disabled`), true);
  await click('.cw-job', 'Draft a return button');
  await wait(`${result}?.includes('No output yet. This work has not started.')`, 'queued example does not claim completion');
  assert.equal(requests.length, 0);
  await fixture('live');
  await click('.cw-job', 'Opening recommendation');
  await wait(`document.querySelector('.cw-source blockquote')?.textContent.includes('Keep the original opening')`, 'late capture becomes held source');
  await evaluate(`(()=>{const el=document.querySelector('.cw-label textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(el,'Make the story clear');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.cw-review button', 'Mark this version');
  await click('.cw-filters button', 'Has output');
  await evaluate(`document.querySelector('#late').click()`);
  await wait(`document.querySelectorAll('.cw-job').length===5`, 'late output appears under retained filter');
  assert.ok(await evaluate(`${result}.includes('Opening recommendation')`), 'late output never steals selection');
  assert.ok(await evaluate(`document.querySelector('.cw-source blockquote').textContent.includes('original opening')`), 'late capture never replaces source');
  await click('.cw-return', 'Return');
  await wait(`document.querySelector('#jump').textContent==='original' && !!document.querySelector('#capture')`, 'return opens exact original capture');
  assert.equal(await evaluate(`document.querySelector('#capture-draft').value`), 'Continue my unfinished thought', 'capture draft preserved');
  await evaluate(`document.querySelector('#mount').click()`);
  await wait(`${result}?.includes('✓ Reviewed this version')`, 'reviewed selection survives jump and return');
  assert.equal(await evaluate(`document.querySelector('.cw-label textarea').value`), 'Make the story clear');
  assert.equal(await evaluate(`document.querySelector('.cw-filters button[aria-pressed=true]').textContent`), 'Has output');
  await evaluate(`document.querySelector('#update').click()`);
  await wait(`${result}?.includes('Revised recommendation.') && !${result}.includes('✓ Reviewed this version')`, 'changed output needs its own review');
  await click('.cw-job', 'Return button proposal');
  await wait(`${result}?.includes('+ returnToCapture();')`, 'server-owned proposal read on inspection');
  assert.deepEqual(requests, [{ result_id: 'check-proposal' }], 'only opaque identity sent');
  assert.ok(await evaluate(`${result}.includes('Validation not run') && ${result}.includes('Read-only proposal') && ${result}.includes('Output truncated')`));
  assert.equal(await evaluate(`document.querySelectorAll('.cw-proposal img').length`), 0, 'diff is escaped text');
  assert.ok(await evaluate(`(()=>{const e=document.querySelector('.cw-proposal pre');e.scrollTop=e.scrollHeight;return e.scrollTop>0})()`), 'long diff scrolls');
  await click('.cw-job', 'Simulated proposal');
  await wait(`${result}?.includes('Simulated work has no live proposal')`, 'simulation never fetches real artifact');
  assert.equal(requests.length, 1);
  refuse = true;
  await click('.cw-job', 'Return button proposal');
  await wait(`${result}?.includes('Only the host can inspect')`, 'host refusal shown without success claim');
  refuse = false;
  await fixture('offline');
  await wait(`${result}?.includes('Disconnected') && ${result}?.includes('Reconnect to inspect')`, 'offline state shown honestly');
  await fixture('changed');
  await wait(`document.querySelector('.cw-return').disabled && ${body}?.includes('source changed or left')`, 'changed source is retained and cannot jump');
  await fixture('missing');
  await wait(`document.querySelector('.cw-return').disabled`, 'missing source cannot jump');
  assert.ok(await evaluate(`document.querySelector('.cw-source blockquote').textContent.includes('original opening')`));
  await fixture('live');
  await click('.cw-filters button', 'All work');
  await click('.cw-job', 'Explore the next scene');
  await wait(`${result}?.includes('No output yet. This work has not started.') && !document.querySelector('.cw-review')`, 'queued live work cannot be reviewed as complete');
  await click('.cw-job', 'Unavailable reference');
  await wait(`${result}?.includes('Failed') && ${result}?.includes('Could not read')`, 'failure and actual diagnostic visible');
  await click('.cw-job', 'Opening recommendation');
  await fixture('partial');
  await wait(`${result}?.includes('Partial result')`, 'partial output never becomes full completion');
  await fixture('failed-outcome');
  await wait(`${result}?.includes('Failed') && !${result}?.includes('Execution finished')`, 'reported failed outcome overrides generic finish');
  await fixture('live');
  await wait(`${result}?.includes('Revised recommendation.')`, 'current output restored');
  const shot = async name => { const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(artifacts, name + '.png'), Buffer.from(data, 'base64')); };
  await shot('desktop');
  for (const width of [390, 320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait(`document.documentElement.scrollWidth<=innerWidth`, `fits ${width}px`);
    await shot(`phone-${width}`);
  }
  await evaluate(`document.querySelector('.cw-return').focus()`);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`!document.querySelector('.concurrent-work')`, 'keyboard return works');
  await evaluate(`document.querySelector('#mount').click()`);
  await fixture('other-visit');
  await wait(`document.querySelector('.cw-label textarea').value===''`, 'new map visit clears intent');
  assert.deepEqual(errors, []);
  console.log(`PASS concurrent-work: scoped TypeScript, production bundle, browser example/live output, exact return/draft/filter/remount, late arrivals, version review, proposal/escaping/refusal/offline, missing/changed source, keyboard, desktop/390/320. Synthetic host, not live model execution. Screenshots: ${artifacts}`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
