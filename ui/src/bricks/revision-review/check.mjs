import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from '../../../node_modules/vite/dist/node/index.js';
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const ui = resolve(directory, '../../..');
const preview = join(ui, 'checks/revision-review');
const artifacts = mkdtempSync(join(tmpdir(), 'revision-review-check-'));
const manifest = JSON.parse(readFileSync(join(directory, 'brick.json'), 'utf8'));
assert.equal(manifest.defaultOn, false);
assert.equal(manifest.kind, 'view');
const types = spawnSync(join(ui, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck', '--noUnusedLocals', '--noUnusedParameters', join(ui, 'src/vite-env.d.ts'), join(preview, 'preview.tsx')], { encoding: 'utf8' });
assert.equal(types.status, 0, `Scoped TypeScript: ${types.stdout}${types.stderr}`);
await build({ configFile: false, root: preview, plugins: [react()], logLevel: 'warn', build: { outDir: join(artifacts, 'built'), emptyOutDir: false, rolldownOptions: { input: join(preview, 'preview.html') } } });
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://check.invalid').pathname;
  const file = resolve(artifacts, 'built', pathname === '/' ? 'preview.html' : `.${pathname}`);
  if (!file.startsWith(join(artifacts, 'built') + '/')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${server.address().port}/`, { width: 1600, height: 1300, preserveProfile: true });
  const errors = [];
  browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  await browser.page('Runtime.enable');
  const wait = async (expression, message) => assert.ok(await browser.until(expression), message);
  const click = async (selector, text = '') => browser.evaluate(`(()=>{const node=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.textContent.includes(${JSON.stringify(text)}));if(!node||node.disabled)throw Error('Missing/enabled control: '+${JSON.stringify(selector + ' ' + text)});node.click();})()`);
  const fill = async (selector, value) => browser.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const body = `document.querySelector('.revision-review')?.textContent`;
  const status = `document.querySelector('[data-review-status]')?.textContent`;
  const screenshot = async name => {
    const { data } = await browser.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, 'base64'));
  };
  await wait(`${body}?.includes('Interactive example · no real work')`, 'labelled example opens');
  await wait(`${status}==='Ready for review · r1'`, 'ready is distinct from approved');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-passage').textContent.includes('Can we name the first action here?')`), 'example includes exact-passage comment');
  await click('.revision-review-words');
  assert.equal(await browser.evaluate(status), 'Ready for review · r1', 'skimming never approves');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-step button[type=submit]').disabled`), 'approval needs explicit human confirmation');
  await screenshot('example-desktop');
  await click('.revision-review-intake summary');
  await fill('.revision-review-intake select', 'source');
  await click('.revision-review-import button');
  await wait(`${status}==='Draft · r1'`, 'real working copy starts draft');
  assert.ok(await browser.evaluate(`${body}.includes('Your artifact · working copy')`), 'real work labelled separately');
  // Choose the second duplicate passage, including the preceding emoji in the offset.
  await browser.evaluate(`(()=>{const root=document.querySelector('.revision-review-words');const start=root.textContent.lastIndexOf('Begin here');const range=document.createRange();range.setStart(root.firstChild,start);range.setEnd(root.firstChild,start+'Begin here'.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);})()`);
  await click('.revision-review-passage button', 'Comment on selected words');
  await fill('.revision-review-comment-form textarea', 'Keep the second instruction concise.');
  await click('.revision-review-comment-form button', 'Attach comment');
  await wait(`document.querySelector('.revision-review-comments').textContent.includes('Keep the second instruction concise.')`, 'comment attached to selected occurrence');
  assert.equal(await browser.evaluate(status), 'Draft · r1', 'comment never advances review');
  await click('.revision-review-step button', 'Mark ready');
  await wait(`${status}==='Ready for review · r1'`, 'ready label visible');
  await fill('.revision-review-step textarea', 'Name the action more clearly.');
  await click('.revision-review-step button', 'Request changes');
  await wait(`${status}==='Changes requested · r1'`, 'human change request is separate from approval');
  await click('.revision-review-editor button', 'Edit as new revision');
  await fill('.revision-review-editor textarea', '🌿 Choose a topic. Then return to the map.');
  await click('.revision-review-editor button', 'Save new revision');
  await wait(`${status}==='Draft · r2'`, 'editing resets review');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-comments').textContent.includes('No comments on this revision.')`), 'comments stay on exact earlier revision');
  await click('.revision-review-history summary');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-history').textContent.includes('Keep the second instruction concise.')`), 'earlier comment retained');
  await click('.revision-review-step button', 'Mark ready');
  await click('.revision-review-check input');
  await click('.revision-review-step button', 'Approve revision 2');
  await wait(`${status}==='Approved · effect pending · r2'`, 'approval alone never completes');
  const complete = `.revision-review-evidence button[type=submit]`;
  assert.ok(await browser.evaluate(`document.querySelector('${complete}').disabled`), 'completion requires checked evidence');
  await fill('.revision-review-evidence label:nth-of-type(1) textarea', 'The updated opening guide is visible to visitors.');
  await fill('.revision-review-evidence label:nth-of-type(2) textarea', 'Human observation: opened the guide and followed Choose a topic back to the map.');
  assert.ok(await browser.evaluate(`document.querySelector('${complete}').disabled`), 'text without verification never completes');
  await click('.revision-review-evidence input');
  await click(complete);
  await wait(`${status}==='Completed · human verified · r2'`, 'verified effect creates completion');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-receipt').textContent.includes('Human observation:')`), 'completion visibly includes its evidence');
  await screenshot('completed-desktop');
  await click('.revision-review-toolbar button', 'Export');
  await wait(`document.querySelector('#download').textContent.includes('second instruction')`, 'export retains comments and history');
  const exported = JSON.parse(await browser.evaluate(`document.querySelector('#download').textContent`));
  assert.equal(exported.artifact.comments[0].start, sourceOffset());
  assert.equal(exported.artifact.comments[0].quote, 'Begin here');
  assert.equal(exported.artifact.revisions[1].receipt.actor, 'Reviewer');
  await click('.revision-review button', 'Open original map words');
  await wait(`!document.querySelector('.revision-review')`, 'source jump leaves view');
  assert.equal(await browser.evaluate(`document.querySelector('#jump').textContent`), 'source');
  await click('#mount');
  await wait(`${status}==='Completed · human verified · r2'`, 'selected artifact and evidence survive return');
  await click('#visit');
  await wait(`${body}?.includes('Interactive example · no real work')`, 'other visit has separate records');
  await click('#visit');
  await wait(`${status}==='Completed · human verified · r2'`, 'original visit retains records');
  await click('#refuse');
  await click('.revision-review-toolbar button', 'Export');
  await wait(`${body}?.includes('Export was refused')`, 'refusal never claims a save');
  await click('.revision-review-editor button', 'Edit as new revision');
  await fill('.revision-review-editor input', 'Opening guide, revised title');
  await click('.revision-review-editor button', 'Save new revision');
  await wait(`${status}==='Draft · r3'`, 'title edit also invalidates approval and completion');
  assert.equal(await browser.evaluate(`document.querySelector('.revision-review-receipt')`), null, 'old completion never appears as current');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-history').textContent.includes('Verified effect · r2')`), 'verified effect stays in history');
  await click('.revision-review-step button', 'Mark ready');
  await click('#ai');
  assert.ok(await browser.evaluate(`document.querySelector('.revision-review-check input').disabled`), 'AI participant cannot approve');
  await click('#ai');
  await click('#guards');
  await wait(`document.querySelector('#guard-result').textContent==='Guards passed'`, 'stale revision and evidence guards hold');
  // Start a fresh non-example artifact through the typed form as well.
  await click('.revision-review-intake summary');
  await fill('.revision-review-intake form input', 'A real release note');
  await fill('.revision-review-intake form textarea', 'The welcome guide now names the first action.');
  await click('.revision-review-intake form button', 'Create artifact');
  await wait(`document.querySelector('.revision-review-passage h2').textContent==='A real release note'`, 'own artifact can be created');
  await click('.revision-review-keyboard summary');
  await fill('.revision-review-keyboard input', 'The');
  await wait(`document.querySelector('.revision-review-keyboard button')?.textContent.includes('characters 1–3')`, 'exact-word picker names the passage offset');
  await browser.evaluate(`document.querySelector('.revision-review-keyboard button').focus()`);
  await browser.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await browser.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`document.querySelector('.revision-review-comment-form blockquote')?.textContent==='The'`, 'keyboard chooses the exact quoted passage');
  await fill('.revision-review-comment-form textarea', 'Keyboard annotation.');
  await click('.revision-review-comment-form button', 'Attach comment');
  await wait(`document.querySelector('.revision-review-comments').textContent.includes('Keyboard annotation.')`, 'keyboard comment attaches to revision');
  await fill('.revision-review-keyboard input', 'THE');
  await wait(`document.querySelector('.revision-review-keyboard').textContent.includes('No exact match')`, 'case mismatch cannot attach the wrong words');
  for (const width of [390, 320]) {
    await browser.page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait(`document.documentElement.scrollWidth<=innerWidth`, `usable width at ${width}px`);
    await screenshot(`phone-${width}`);
  }
  // A keyboard decision is still explicit and keeps native focus behavior.
  await browser.evaluate(`Array.from(document.querySelectorAll('.revision-review-step button')).find(node=>node.textContent.includes('Mark ready')).focus()`);
  await browser.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await browser.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(`${status}==='Ready for review · r1'`, 'keyboard ready action works');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS revision-review: scoped TypeScript, isolated production bundle, desktop/390/320px browser flow; exact duplicate passage, changes/approval/completion, stale guards, history, export/refusal, source return, visit isolation, AI restriction, keyboard. Screenshots: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

function sourceOffset() { return '🌿 Begin here. Begin here. Then return to the map.'.lastIndexOf('Begin here'); }
