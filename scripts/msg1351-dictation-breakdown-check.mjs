// Focused synthetic acceptance. Own browser/profile/server; no microphone, queue writer or host wiring.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUi, uiServer } from './ui-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const lane = resolve(root, 'ui/src/msg1351/dictation-breakdown');
const artifacts = mkdtempSync(join(tmpdir(), 'dictation-breakdown-check-'));
const result = await buildUi({ configFile: false, logLevel: 'error', build: { write: false, minify: false,
  lib: { entry: join(lane, 'engine.ts'), formats: ['es'] } } });
const output = Array.isArray(result) ? result[0] : result;
const engine = await import(`data:text/javascript;base64,${Buffer.from(output.output.find(chunk => chunk.type === 'chunk').code).toString('base64')}`);

function checkEngine() {
  const { startReview, splitItem, rejoinItem, correctItem, exportWorkflow, speakerProfiles, syntheticDictation: source,
    syntheticHomes: homes, assertCoverage, characters, proposedBoundaries, dictationBreakdownFeature } = engine;
  assert.equal(dictationBreakdownFeature.defaultEnabled, false);
  const careful = speakerProfiles[0], expressive = speakerProfiles[1], manual = speakerProfiles[2];
  let review = startReview(source, careful);
  assert.equal(review.items.length, 3, 'tangent and return form ideas; quoted cues do not split');
  assert.ok(review.items[1].source.text.includes('"Next, stop. Back to work"'));
  assert.equal(review.items[0].why, 'the plants need water');
  assert.equal(review.items[0].reasonOrigin, 'stated');
  assert.equal(review.items[2].reasonOrigin, 'inferred');
  const missed = characters(source.slice(0, source.indexOf('The tiny leaf'))).length;
  review = splitItem(review, review.items[2].id, missed);
  const access = characters(source.slice(0, source.indexOf('Keep keyboard'))).length;
  review = splitItem(review, review.items[3].id, access);
  assert.equal(review.items[3].what, 'The tiny leaf is lovely.');
  assert.equal(review.items[3].reasonOrigin, 'unspecified');
  assertCoverage(source, review.items);
  const original = review;
  review = correctItem(review, review.items[3].id, { what: 'Keep the leaf aside', why: 'For later', reviewedBy: 'red-team' });
  assert.equal(review.items[3].reasonOrigin, 'corrected');
  assert.equal(review.items[3].reviewedBy, 'unreviewed', 'content edits require a fresh review');
  assert.equal(review.items[3].source.text, original.items[3].source.text);
  const homesBefore = JSON.stringify(homes), exported = exportWorkflow(review, homes);
  assert.equal(exported.items.map(item => item.source.text).join(''), source);
  assert.ok(exported.items[1].queueProposals.every(proposal => proposal.duplicate));
  assert.equal(exported.items[4].queueProposals[0].name, 'Accessibility');
  assert.equal(JSON.stringify(homes), homesBefore, 'proposals never mutate queue homes');
  assert.ok(Object.isFrozen(exported.items[0].source) && Object.isFrozen(exported.items[1].queueProposals[0]));
  let falseSplit = startReview('Paint the box. Next, paint its lid.', expressive);
  assert.equal(falseSplit.items.length, 2);
  falseSplit = rejoinItem(falseSplit, falseSplit.items[1].id);
  assert.equal(falseSplit.items.length, 1);
  assert.equal(falseSplit.items[0].source.text, 'Paint the box. Next, paint its lid.');
  assert.equal(startReview(source, manual).items.length, 1, 'personal profile never forces a split');
  assert.equal(proposedBoundaries('One. On anothr topic, two.', expressive).length, 1);
  assert.equal(proposedBoundaries('One. Item 2: two.', careful).length, 1);
  for (const text of ['One. “Next, wait. Back to work”. Done.', "One. 'Next, wait. Back to work'. Done."])
    assert.equal(startReview(text, expressive).items.length, 1, 'quoted phrases remain intact');
  const unicode = startReview('🌱 é. 旁白', manual);
  const divided = splitItem(unicode, unicode.items[0].id, 2);
  assert.equal(divided.items[0].source.text, '🌱 ');
  assertCoverage(unicode.source, divided.items);
  assert.throws(() => splitItem(unicode, unicode.items[0].id, 0), /inside/);
  assert.throws(() => startReview('  ', manual), /transcript/);
  console.log('PASS deterministic extraction, profiles, quote safety, corrections, coverage and frozen export');
}

function checkRust() {
  const binary = join(artifacts, 'source-span-tests');
  let run = spawnSync('rustc', ['--edition=2021', '--test', resolve(root, 'core/src/msg1351_dictation_breakdown/mod.rs'), '-o', binary], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  run = spawnSync(binary, ['--quiet'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  console.log('PASS Rust source admission: 3 tests');
}

async function launchBrowser(url) {
  const executable = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executable, 'Chrome required for visible acceptance');
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(artifacts, 'chrome-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-breakpad', '--disable-crash-reporter', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  async function close() {
    socket?.close();
    if (child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      await exited;
    }
    child.stderr.destroy();
  }
  try {
    const address = await new Promise((resolveAddress, reject) => {
      let text = '';
      const timeout = setTimeout(() => reject(new Error('Browser startup timed out')), 15000);
      child.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolveAddress(match[1]); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Browser exited during startup')); });
    });
    socket = new WebSocket(address);
    await once(socket, 'open');
    let id = 0; const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), handler = pending.get(message.id);
      if (handler) { pending.delete(message.id); message.error ? handler.reject(new Error(JSON.stringify(message.error))) : handler.resolve(message.result); }
    });
    const command = (method, params = {}, sessionId) => new Promise((resolveCommand, reject) => {
      const next = ++id; pending.set(next, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    const evaluate = async expression => {
      const answer = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
      return answer.result.value;
    };
    const until = async expression => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(resolveWait => setTimeout(resolveWait, 40));
      }
      throw new Error(`Visible condition timed out: ${expression}`);
    };
    await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url });
    return { page, evaluate, until, close };
  } catch (error) { await close(); throw error; }
}

async function checkPage() {
  const server = await uiServer({ appType: 'spa', logLevel: 'error' }, { port: 0 });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    assert.ok(![4360, 4399].includes(port));
    browser = await launchBrowser(`http://127.0.0.1:${port}/src/msg1351/dictation-breakdown/preview.html`);
    const { evaluate, until, page } = browser;
    const click = label => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!button) throw Error('Missing button'); button.click(); })()`);
    const count = number => until(`document.querySelectorAll('.db-item').length===${number}`);
    await until(`document.querySelector('input[type=checkbox]')!==null`);
    assert.equal(await evaluate(`document.querySelector('input[type=checkbox]').checked`), false);
    assert.equal(await evaluate(`document.querySelector('[aria-label=Transcript]')`), null);
    await evaluate(`document.querySelector('input[type=checkbox]').click()`);
    await until(`document.querySelector('[aria-label=Transcript]')!==null`);
    await click('Propose items'); await count(3);
    assert.ok(await evaluate(`document.querySelectorAll('.db-item')[1].textContent.includes('Possible duplicate home')`));
    await evaluate(`document.querySelectorAll('.db-item')[1].querySelectorAll('button')[1].click()`);
    await count(2);
    await click('Undo last change'); await count(3);
    // Select a missed aside using the real source cursor contract.
    await evaluate(`(() => { const area=document.querySelectorAll('.db-item')[2].querySelector('textarea[readonly]'); area.focus(); const at=area.value.indexOf('The tiny leaf'); area.setSelectionRange(at,at); document.querySelectorAll('.db-item')[2].querySelector('button').click(); })()`);
    await count(4);
    assert.ok(await evaluate(`document.querySelectorAll('.db-item')[3].querySelector('textarea').value.startsWith('The tiny leaf')`));
    await evaluate(`(() => { const field=document.querySelector('[aria-label="What for item 1"]'); field.focus(); })()`);
    await page('Input.insertText', { text: 'Corrected reminder' });
    await until(`document.querySelector('[aria-label="What for item 1"]').value.includes('Corrected reminder')`);
    assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'What for item 1', 'typing keeps focus');
    await click('Mark red-team reviewed');
    await until(`document.querySelector('.db-item').textContent.includes('Reviewed: red-team')`);
    await click('Prepare workflow export');
    const exported = JSON.parse(await evaluate(`document.querySelector('[aria-label="Workflow export"]').value`));
    assert.equal(exported.items.map(item => item.source.text).join(''), exported.source);
    assert.equal(exported.items.length, 4);
    await evaluate(`document.querySelector('input[type=checkbox]').click()`);
    await count(0);
    await evaluate(`document.querySelector('input[type=checkbox]').click()`);
    await count(4);
    assert.ok(await evaluate(`document.querySelector('[aria-label="What for item 1"]').value.includes('Corrected reminder')`));
    await click('Rebuild from transcript'); await count(3);
    await click('Undo last change'); await count(4);
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.ok(await evaluate(`document.activeElement.matches('button,input,textarea,select,summary')`), 'keyboard reaches a control');
    async function screenshot(name) {
      const image = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(artifacts, name), Buffer.from(image.data, 'base64'));
    }
    await evaluate(`window.scrollTo(0,0)`); await screenshot('desktop.png');
    await page('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    await until(`document.documentElement.clientWidth===360`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=360`), 'phone has no horizontal overflow');
    await screenshot('phone.png');
    await evaluate(`document.querySelector('.db-item').scrollIntoView({block:'start'})`);
    await screenshot('phone-item.png');
    assert.ok(await evaluate(`[...document.querySelectorAll('.db-item button')].every(button=>button.getBoundingClientRect().height>=44)`), 'correction controls have reachable touch targets');
    await evaluate(`document.querySelector('.dictation-breakdown').style.fontSize='200%'`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=360`), 'enlarged text fits phone');
    await screenshot('phone-large-text.png');
    console.log('PASS visible split/rejoin/undo, corrections, export, off/on retention, keyboard, phone and enlarged text');
  } finally { await browser?.close(); await server.close(); }
}

checkEngine();
checkRust();
await checkPage();
console.log(`Evidence retained: ${artifacts}`);
