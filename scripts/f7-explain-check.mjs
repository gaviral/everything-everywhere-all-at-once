// Synthetic real-core + real built UI acceptance. No credentials, app data or model service.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ready, openPage, standInCore, sleep } from './headless.mjs';
import { empty } from './capture-fixture.mjs';

// Also clears the environment inherited by Chrome through the existing browser helper.
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|AUTH|PROXY/i.test(name)) delete process.env[name];
const unavailable = ready();
assert.equal(unavailable, '', `browser acceptance requires Chrome and a built UI: ${unavailable}`);
const root = new URL('../', import.meta.url).pathname;
const output = mkdtempSync(join(tmpdir(), 'f7-explain-check-'));
const env = { ...process.env, F7_EXPLAIN_FIXTURE_DIR: output };
const build = execFileSync('cargo', ['test', '--manifest-path', 'core/Cargo.toml', '--no-run', '--message-format=json'], { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const executable = build.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(m => m.reason === 'compiler-artifact' && m.executable && m.profile.test)?.executable;
assert.ok(executable, 'compiled test fixture executable');
console.log(`f7-explain-check: starting ${executable.split("/").at(-1)}`);
const child = spawn(executable, ['f7_explain_browser_fixture', '--ignored', '--nocapture'], { cwd: output, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
process.on('exit', stop);
let browser, emptyCore;
try {
  for (let n = 0; !existsSync(join(output, 'port')) && n < 1200 && child.exitCode === null; n++) await sleep(50);
  assert.ok(existsSync(join(output, 'port')), `fixture started (exit ${child.exitCode}, signal ${child.signalCode}): ${log.slice(-1000)}`);
  const port = Number(readFileSync(join(output, 'port'), 'utf8'));
  assert.ok(port > 0 && ![4360, 4399].includes(port), 'OS-assigned allowed port');
  const url = `http://127.0.0.1:${port}/`;
  const stats = async () => (await fetch(`${url}f7-stats`)).json();
  browser = await openPage('about:blank');
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.errors=[]; window.sent=[]; window.answers=[];
    addEventListener('error',e=>{ if(!e.message.startsWith('ResizeObserver')) errors.push(e.message) });
    const Socket=WebSocket;
    window.WebSocket=class extends Socket { constructor(...args) { super(...args); this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='explanation') answers.push(m)}catch{}}); } send(data) {if(typeof data==='string') {try{sent.push(JSON.parse(data))}catch{}} super.send(data);}};
  ` });
  const key = async (key, code = key, text) => {
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, ...(key === 'Enter' ? { windowsVirtualKeyCode: 13 } : {}), ...(text && type === 'keyDown' ? { text } : {}) });
  };
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const feature = '[role="switch"][aria-label="Reuse explanations"]';
  const openFeatures = async () => {
    if (!await evaluate(`!!document.querySelector(${JSON.stringify(feature)})`)) await click('[data-guide="catalog"]');
    assert.ok(await until(`!!document.querySelector(${JSON.stringify(feature)})`), 'Features opens');
  };
  const focus = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const showCanvas = async () => {
    if (await evaluate(`!!document.querySelector('.shell-rail-close')`)) await click('.shell-rail-close');
    if (await evaluate(`!!document.querySelector('.shell-bl button[aria-keyshortcuts="M"]')`)) await click('.shell-bl button[aria-keyshortcuts="M"]');
    assert.ok(await until(`!!document.querySelector('.spine-ready [data-thought="th-0"] .spine-text')`, 10000), 'existing source is mounted on the Canvas');
  };
  const pick = async () => {
    // Select the visible Canvas source rather than a retained offscreen Cards tree.
    await showCanvas();
    await evaluate(`(()=>{ const e=document.querySelector('[data-thought="th-0"] .spine-text'); const r=e.getBoundingClientRect(); e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'})); e.focus({preventScroll:true}); e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2})); window.pickBounds=null; window.pickStable=0; })()`);
    assert.ok(await until(`!!document.querySelector('[data-thought="th-0"].spine-selecting')`), 'Canvas text selection mode');
    assert.ok(await until(`(()=>{ const r=document.querySelector('[data-thought="th-0"] .spine-text').getBoundingClientRect(); const next=[r.x,r.y,r.width,r.height].map(n=>Math.round(n)).join(','); window.pickStable=next===window.pickBounds?window.pickStable+1:0; window.pickBounds=next; return r.width>0&&r.top>=0&&r.bottom<=(document.querySelector('.dock')?.getBoundingClientRect().top??innerHeight)&&window.pickStable>=2; })()`, 4000), 'visible source layout is settled');
    await evaluate(`(()=>{ const el=document.querySelector('[data-thought="th-0"] .spine-text'); window.pickFocus=document.activeElement;
      const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){const at=node.textContent.indexOf('Mulch');if(at>=0){const r=document.createRange();r.setStart(node,at);r.setEnd(node,at+5);getSelection().removeAllRanges();getSelection().addRange(r);break;}}
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true})); })()`);
    assert.ok(await until(`!!document.querySelector('.explain > button')`), 'selection offers Explain without requesting it');
  };
  const explain = async (keyboard = false) => {
    const count = await evaluate('answers.length');
    if (keyboard) await key('Enter', 'Enter', '\r'); else await click('.explain > button');
    assert.ok(await until(`answers.length===${count + 1} && !!document.querySelector('.explain-off')`, 1500), 'answer arrives for the new request');
    return evaluate('answers.at(-1)');
  };
  const closeAnswer = async (escape = false) => {
    await focus('[aria-label="Dismiss explanation"]');
    if (escape) await key('Escape'); else await click('[aria-label="Dismiss explanation"]');
    assert.ok(await until(`!document.querySelector('.explain')`), 'answer closes');
    assert.equal(await until('document.activeElement===window.pickFocus'), true, 'focus returns to source');
    await evaluate('getSelection().removeAllRanges(); document.dispatchEvent(new KeyboardEvent("keyup",{key:"Shift",bubbles:true}))');
  };
  const inViewport = async selector => {
    assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&e.scrollHeight<=e.clientHeight+1})()`), `${selector} fits without clipping`);
  };
  const textZoom = async on => {
    await evaluate(on ? `(()=>{
      const sizes=[...document.querySelectorAll('body *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize),el.style.fontSize]);
      window.fontRestore=sizes; for(const [el,size] of sizes) el.style.fontSize=(size*2)+'px'; if(document.querySelector('.explain')){const node=getSelection()?.anchorNode;const source=node instanceof Element?node:node?.parentElement;source?.scrollIntoView({block:'center',behavior:'instant'});} dispatchEvent(new Event('resize'));
    })()` : `(()=>{for(const [el,,before] of window.fontRestore??[]) el.style.fontSize=before;dispatchEvent(new Event('resize'))})()`);
  };
  const shot = async name => {
    const result = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(output, name), Buffer.from(result.data, 'base64'));
  };
  await page('Page.navigate', { url });
  assert.ok(await until(`!!document.querySelector('#type-a-thought')`, 10000), 'real app mounted');
  assert.equal(await evaluate('localStorage.getItem("e2a2o.features")'), null, 'fresh feature storage');
  if (await evaluate(`!!document.querySelector('.tour-skip')`)) await click('.tour-skip');
  assert.equal(await evaluate(`!!document.querySelector('.explain') || document.body.textContent.includes('Reuse explanations')`), false, 'no feature UI before Features or an explicit request');
  assert.equal((await stats()).calls, 0, 'fresh page does not warm');
  assert.equal(await evaluate(`sent.some(m=>m.type==='explain'||m.reuse===true)`), false, 'no feature-specific messages');
  await openFeatures();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(feature)}).getAttribute('aria-checked')`), 'false', 'off by default');
  await showCanvas();
  await pick();
  assert.equal((await stats()).calls, 0, 'selection itself does not request');
  await explain(); await closeAnswer();
  assert.deepEqual(await stats(), { calls: 1, entries: 0, served: 0 }, 'baseline request does not populate');
  const baseline = await evaluate(`sent.find(m=>m.type==='explain')`);
  assert.equal(baseline.reuse, false);
  assert.deepEqual(Object.keys(baseline).sort(), ['context','id','reuse','text','thread_id','type'], 'baseline wire contract plus additive false');
  await openFeatures(); await focus(feature); await key(' ', 'Space', ' ');
  assert.ok(await until(`document.querySelector(${JSON.stringify(feature)}).getAttribute('aria-checked')==='true'`), 'Space enables through Features');
  assert.equal(await evaluate('document.activeElement.matches(":focus-visible")'), true, 'switch has keyboard focus');
  assert.equal((await stats()).calls, 1, 'enable does not call the provider');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('#type-a-thought')`, 10000));
  await openFeatures();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(feature)}).getAttribute('aria-checked')`), 'true', 'switch survives reload');
  await showCanvas(); await pick();
  const first = await explain();
  assert.equal((await stats()).calls, 2, 'first opted-in request uses provider');
  await closeAnswer(true); await pick();
  const hit = await explain(true);
  assert.notEqual(hit.id, first.id, 'new request ID on repeat');
  assert.equal(hit.text, first.text, 'identical sentence');
  assert.equal((await stats()).calls, 2, 'repeat in real UI has no second fake-model request');
  await inViewport('.explain'); await inViewport('[aria-label="Dismiss explanation"]');
  await shot('desktop-1440.png');
  await focus('.explain-off'); await key('Enter', 'Enter', '\r');
  assert.ok(await until(`document.querySelector('.explain-off').getAttribute('aria-pressed')==='true'`), 'Off feedback remains usable');
  assert.equal((await stats()).entries, 0, 'marking the hit off invalidates');
  assert.equal(await evaluate(`sent.filter(m=>m.type==='mark').at(-1).id`), hit.id, 'mark correlates to current hit');
  await closeAnswer(); await pick(); await explain();
  assert.equal((await stats()).calls, 3, 'off answer must be asked again');
  await closeAnswer();

  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await pick(); await explain(true); await inViewport('.explain'); await shot('phone-390-dark.png');
  assert.equal((await stats()).calls, 3, 'phone repeat still reuses');
  await textZoom(true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.explain-card [role="status"]')).fontSize`), '28px', 'explanation text is actually doubled');
  await inViewport('.explain'); await inViewport('[aria-label="Dismiss explanation"]');
  // Exercise the actual autosizing input with synthetic draft text at this size.
  await focus('#type-a-thought'); await page('Input.insertText', { text: 'soil' });
  assert.ok(await until(`document.querySelector('#type-a-thought').value==='soil'`));
  await inViewport('#type-a-thought'); await shot('phone-answer-text-200.png');
  await evaluate(`document.querySelector('#type-a-thought').select()`);
  await page('Input.insertText', { text: '' });
  await textZoom(false); await closeAnswer(true);
  await openFeatures(); await textZoom(true);
  await evaluate(`document.querySelector(${JSON.stringify(feature)}).scrollIntoView({block:'center'})`);
  await inViewport(feature);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-row="reuse-explanations"] .shell-catalog-name')).fontSize`), '26px', 'setting text is actually doubled');
  assert.ok(await evaluate(`(()=>{const e=document.querySelector('[data-row="reuse-explanations"] .shell-catalog-name');return e.scrollWidth<=e.clientWidth+1})()`), 'full setting name stays readable');
  await shot('phone-390-text-200.png');
  await focus(feature); await key(' ', 'Space', ' ');
  assert.ok(await until(`document.querySelector(${JSON.stringify(feature)}).getAttribute('aria-checked')==='false'`), 'disable works by keyboard at 200% text');
  const beforeDisable = await stats();
  await key('Escape');
  await textZoom(false);
  await pick(); await explain(); await closeAnswer();
  await pick(); await explain(); await closeAnswer(true);
  assert.equal((await stats()).calls, beforeDisable.calls + 2, 'disabled repeats use baseline provider path');
  assert.equal((await stats()).served, beforeDisable.served, 'disabled requests add no cache history');
  assert.equal(await evaluate(`sent.filter(m=>m.type==='explain').slice(-2).every(m=>m.reuse===false)`), true, 'disabled wire path');
  const idle = await stats(); await sleep(250);
  assert.deepEqual(await stats(), idle, 'no work after disabling or closing');
  assert.deepEqual(await evaluate('errors'), []);
  await browser.close(); browser = null;

  // Honest empty state, fresh phone storage: enabling has nothing to explain and no warm request.
  emptyCore = await standInCore(() => [{ type: 'snapshot', world: empty() }]);
  browser = await openPage(`http://127.0.0.1:${emptyCore.port}/`, { width: 390, height: 844 });
  assert.ok(await browser.until(`!!document.querySelector('[data-map-capture=active]')`, 10000), 'empty map welcome');
  await browser.evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await browser.until(`!!document.querySelector(${JSON.stringify(feature)})`));
  await browser.evaluate(`document.querySelector(${JSON.stringify(feature)}).click()`);
  assert.equal(await browser.evaluate(`!!document.querySelector('.explain')`), false, 'empty enabled state adds no invented answer');
  assert.equal(emptyCore.heard.some(m => m.type === 'explain' || m.reuse === true), false, 'empty enabling is idle');
  const image = await browser.page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(output, 'phone-empty.png'), Buffer.from(image.data, 'base64'));
  console.log(`f7-explain-check: PASS real core/UI, opt-in persistence, reuse, IDs, off marks, disabled baseline, keyboard, empty/phone/dark/reduced/200%; screenshots ${output}`);
} catch (error) {
  if (browser) {
    try {
      const image = await browser.page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(output, 'failure.png'), Buffer.from(image.data, 'base64'));
    } catch { /* original assertion remains the failure */ }
  }
  console.error(`f7-explain-check artifacts: ${output}`);
  throw error;
} finally {
  await browser?.close(); emptyCore?.close();
  stop();
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]);
  writeFileSync(join(output, 'fixture.log'), log);
}
