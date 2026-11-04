// Built UI + fresh, keyless Rust core, public sample and one synthetic pending capture. No text sends.
// BASELINE=1 records the old geometry; SHOTS selects an ignored evidence directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { openPage, sleep, ready } from './headless.mjs';

assert.equal(ready(), '', 'built UI and Chrome required');
const root = resolve(new URL('..', import.meta.url).pathname);
const baseline = process.env.BASELINE === '1';
const shots = resolve(process.env.SHOTS || `data/gallery-clearance-evidence/${baseline ? 'before' : 'after'}`);
mkdirSync(shots, { recursive: true });
const draft = '  Unsent gallery draft — keep this exact text.\nSecond line.  ';
const pendingText = 'Synthetic pending capture: keep the original words while browsing pictures.';
const captureId = '293842a0-b25e-4e4a-b902-0c992ba52671';
const report = [];

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.ok(![4360, 4399].includes(port));
  return port;
}

async function startCore(pending) {
  const fixture = mkdtempSync(join(tmpdir(), 'gallery-clearance-'));
  const cwd = join(fixture, 'run'), data = join(fixture, 'sample');
  mkdirSync(cwd); mkdirSync(data);
  // Stop dotenv's upward search at our empty synthetic files; inherit no account/service credentials.
  writeFileSync(join(fixture, '.env'), ''); writeFileSync(join(cwd, '.env'), '');
  let sample = readFileSync(join(root, 'samples/student-week.jsonl'), 'utf8');
  if (pending) {
    const thought = { id: 'gallery-pending', speaker: 'you', text: pendingText, point: '', thread_id: null,
      placed: false, unclear: '', guess: '', complete: true, at_ms: Date.now(), place_ms: null };
    sample += '\n' + JSON.stringify({ type: 'thought_added', thought,
      source: { speaker: 'you', id: captureId, text: pendingText } }) + '\n';
    sample += JSON.stringify({ type: 'thread_touched', thread_id: 'T3', at_ms: Date.now(),
      last_point: 'Synthetic extended caption: review the group project agenda, confirm the meeting time, preserve the source topic, and read every word of this final description before opening the picture.' }) + '\n';
  }
  writeFileSync(join(data, 'journal.jsonl'), sample);
  cpSync(join(root, 'samples/images/student-week'), join(data, 'images'), { recursive: true });
  const port = await freePort();
  const core = spawn(join(root, 'core/target/debug/e2a2o-core'), [], { cwd,
    env: { PATH: process.env.PATH, PORT: String(port), E2A2O_DATA: data, E2A2O_UI: join(root, 'ui/dist'),
      E2A2O_SAMPLES: join(root, 'samples'), PRESET: 'demo', RUST_LOG: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  core.stdout.on('data', bytes => { log += bytes; }); core.stderr.on('data', bytes => { log += bytes; });
  const close = async () => {
    if (core.exitCode === null) { core.kill('SIGTERM'); await once(core, 'exit'); }
    writeFileSync(join(shots, `core-${pending ? 'pending' : 'sample'}.log`), log);
  };
  try {
    for (let i = 0; i < 200; i++) {
      if (core.exitCode !== null) throw new Error(`Core exited: ${log}`);
      if (await fetch(`http://127.0.0.1:${port}/room`).then(r => r.ok).catch(() => false)) return { port, close };
      await sleep(50);
    }
    throw new Error('Core did not listen');
  } catch (error) { await close(); throw error; }
}

async function sourceSnapshot(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?identity=1`);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Source readback timed out')); }, 5000);
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Source readback failed')); };
    let identity;
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'map_identity') identity = message.id;
      if (message.type === 'snapshot') { clearTimeout(timer); socket.close(); resolve({ identity, world: message.world }); }
    };
  });
}

// Hit tests plus rectangle intersections: sparse hit points alone can miss Back across a long caption.
const clear = selector => `(() => {
  const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return {clear:false, missing:true};
  const r=e.getBoundingClientRect(); const hits=[];
  for(const x of [r.left+2,r.left+r.width/2,r.right-2]) for(const y of [r.top+2,r.top+r.height/2,r.bottom-2]) {
    const top=document.elementFromPoint(x,y); if(!top || !(e.contains(top)||top.contains(e))) hits.push(top?.className||'outside');
  }
  if(e.closest('.palace')) {
    for(const selector of ['.shell-bl','.shell-tr','.shell-tl','.sample-recovery-actions']) {
      const bar=document.querySelector(selector); if(!bar) continue; const b=bar.getBoundingClientRect();
      if(r.left<b.right && r.right>b.left && r.top<b.bottom && r.bottom>b.top) hits.push(selector);
    }
    const dock=document.querySelector('.shell-dock')?.getBoundingClientRect();
    if(dock && r.bottom>dock.top-12) hits.push('dock band');
  }
  return {clear:r.top>=64 && r.bottom<=innerHeight && !hits.length, top:r.top,bottom:r.bottom,height:r.height,
    clipped:e.scrollHeight>e.clientHeight+1,hits};
})()`;

async function runCase(core, pending, width, height) {
  const label = `${width === 390 ? 'phone' : 'desktop'}-${pending ? 'pending' : 'sample'}`;
  const browser = await openPage('about:blank', { width, height });
  const { page, evaluate, until } = browser;
  const sent = [], snapshots = [], identities = [];
  browser.on('Network.webSocketFrameSent', ({ response }) => { try { sent.push(JSON.parse(response.payloadData)); } catch {} });
  browser.on('Network.webSocketFrameReceived', ({ response }) => { try {
    const message = JSON.parse(response.payloadData);
    if (message.type === 'snapshot') snapshots.push(message.world);
    if (message.type === 'map_identity') identities.push(message.id);
  } catch {} });
  const key = async (key, code, windowsVirtualKeyCode) => {
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode,
      ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) });
  };
  const shot = async suffix => {
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${label}-${suffix}.png`), Buffer.from(data, 'base64'));
  };
  const hiddenCanvas = async () => {
    assert.ok(await until(`(() => {
      const frames = [...document.querySelectorAll('.persistent-canvas .spine-frame')];
      return document.documentElement.dataset.view !== 'map' && frames.length > 0
        && frames.every(e => getComputedStyle(e).opacity === '0');
    })()`), `${label}: hidden Canvas has zero opacity in Pictures`);
  };
  try {
    await page('Network.enable');
    if (width === 390) await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?sample` });
    assert.ok(await until(`!!document.querySelector('.spine-ready') && !!document.querySelector('#type-a-thought')`, 15000), `${label}: Feature-Off Canvas`);
    assert.equal(await evaluate(`document.documentElement.dataset.view`), 'map');
    assert.equal(await evaluate(`!!document.querySelector('.palace')`), false);
    assert.ok(snapshots.length && identities.length, `${label}: actual core snapshot and map identity`);
    const source = JSON.stringify(snapshots[0].thoughts);
    await evaluate(`document.querySelector('#type-a-thought').focus()`);
    await page('Input.insertText', { text: draft });
    // The public sample's existing Pictures affordance; no feature/default rewrite.
    await evaluate(`[...document.querySelectorAll('.sample-recovery-actions button')].find(e=>e.textContent==='Pictures').click()`);
    assert.ok(await until(`!!document.querySelector('.palace-tile')`));
    await hiddenCanvas();
    await evaluate('document.fonts.ready');
    assert.equal(await evaluate(`document.activeElement?.classList.contains('palace-tile')`), true, 'gallery entry focus');
    if (pending) assert.ok(await until(`document.querySelector('[data-capture="${captureId}"]')?.textContent.includes(${JSON.stringify(pendingText)})`), 'pending card visible');
    // The real unfinished card lands about 2.5 s after load and grows the dock mid-measure: put it aside first.
    if (await until(`!!document.querySelector('.pullback')`, 6000)) await evaluate(`[...document.querySelectorAll('.pullback-actions button')].find(e=>e.textContent==='Later').click()`);
    assert.ok(await until(`!document.querySelector('.pullback')`), 'unfinished card set aside');
    const ids = await evaluate(`[...document.querySelectorAll('.palace-tile')].map(e=>e.dataset.thread)`);
    const last = ids.at(-1);
    assert.equal(last, 'T5', 'last image retains public sample topic identity');
    // Group project meeting (T3) and Mom's birthday (T5) share the desktop's final row.
    const description = '.palace-tile[data-thread="T3"] .palace-point';
    await evaluate(`document.querySelector(${JSON.stringify(description)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await sleep(200);
    const centered = await evaluate(clear(description));
    await shot('center');
    await evaluate(`window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);
    await sleep(200);
    const end = await evaluate(clear(description));
    const lastEnd = await evaluate(clear(`.palace-tile[data-thread="${last}"] .palace-point`));
    const atEnd = await evaluate(`Math.abs(scrollY+innerHeight-document.documentElement.scrollHeight)<=1`);
    assert.ok(atEnd, 'true end reached');
    await shot('end');
    const geometry = { label, centered, end, lastEnd, atEnd, dockHeight: await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--dock-height')`) };
    report.push(geometry);
    if (!baseline) {
      // On a phone T3 precedes T5, so first explicitly inspect T3, then the actual final description.
      assert.ok(end.clear, `${label}: Group project description clear at true end: ${JSON.stringify(end)}`);
      assert.ok(lastEnd.clear, `${label}: final description clear at true end: ${JSON.stringify(lastEnd)}`);
      // Center each image/title/description separately, including captions longer than the old two-line clamp.
      for (const id of ids) for (const part of ['.palace-art', '.palace-title', '.palace-point']) {
        const selector = `.palace-tile[data-thread="${id}"] ${part}`;
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
        await sleep(35);
        const box = await evaluate(clear(selector));
        assert.ok(box.clear && !box.clipped, `${label} ${id} ${part}: ${JSON.stringify(box)}`);
      }
      // Real arrow-key traversal, without test scroll correction, must keep the whole focused tile clear.
      await evaluate(`document.querySelector('.palace-tile').focus()`);
      for (let i = 1; i < ids.length; i++) {
        await key('ArrowRight', 'ArrowRight', 39); await sleep(40);
        assert.equal(await evaluate(`document.activeElement?.dataset.thread`), ids[i]);
        assert.ok((await evaluate(clear(`.palace-tile[data-thread="${ids[i]}"]`))).clear, `${label}: focused tile ${ids[i]} clear`);
      }
      await key('ArrowLeft', 'ArrowLeft', 37); await key('ArrowRight', 'ArrowRight', 39);
      await shot('keyboard-last');
      // Click the image itself, not its caption or a programmatic navigation handler.
      const point = await evaluate(`(() => {const r=document.querySelector('.palace-tile[data-thread="${last}"] .palace-art').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      assert.ok(await until(`document.documentElement.dataset.view==='map' && !!document.querySelector('.spine-ready')`));
      assert.ok(await until(`!!document.querySelector('.spine-head[data-thread="${last}"],.spine-topic[data-thread="${last}"],.spine-card[data-thread="${last}"]')`));
      assert.ok(sent.some(m => m.type === 'focus' && m.thread_id === last), 'image opens correct source topic');
      assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), draft, 'exact unsent draft');
      const readback = await sourceSnapshot(core.port);
      assert.equal(JSON.stringify(readback.world.thoughts), source, 'independent source readback unchanged');
      assert.equal(readback.identity, identities[0], 'same source map identity');
      assert.equal(readback.world.active_by?.you ?? readback.world.active, last, 'core confirms correct topic');
      await shot('topic');
      await evaluate(`[...document.querySelectorAll('.sample-recovery-actions button')].find(e=>e.textContent==='Pictures').click()`);
      assert.ok(await until(`!!document.querySelector('.palace')`));
      await hiddenCanvas();
      await evaluate(`document.querySelector('.shell-bl button').focus()`);
      await key('Enter', 'Enter', 13);
      assert.ok(await until(`document.documentElement.dataset.view==='map' && !!document.querySelector('.spine-ready')`), 'Back keyboard return');
      // The composer is the last tab stop; Tab from it may legitimately leave the document.
      // Exercise the app's keyboard path into it instead.
      await evaluate(`document.querySelector('.skip-link').focus()`);
      await key('Enter', 'Enter', 13);
      assert.equal(await evaluate(`document.activeElement?.id`), 'type-a-thought', 'keyboard path reaches composer');
      assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), draft);
      assert.ok(!sent.some(m => ['text','listen','sample','import'].includes(m.type)), 'no sends, microphone or imports');
      assert.equal(new Set(identities).size, 1, 'source map identity retained');
      assert.ok((await evaluate(clear('#type-a-thought'))).clear, 'composer reachable');
    }
    console.log(`${label}: ${baseline ? `baseline end clear=${end.clear}` : 'passed'}`);
  } catch (error) {
    await shot('failure');
    writeFileSync(join(shots, `${label}-failure.json`), JSON.stringify(await evaluate(`({view:document.documentElement.dataset.view,
      focus:document.activeElement?.outerHTML,scrollY,back:document.querySelector('.shell-bl')?.outerHTML})`), null, 2));
    throw error;
  } finally { await browser.close(); }
}

try {
  for (const pending of [false, true]) {
    const core = await startCore(pending);
    try { for (const [width, height] of [[1440,900],[390,844]]) await runCase(core, pending, width, height); }
    finally { await core.close(); }
  }
} finally { writeFileSync(join(shots, 'geometry.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(`gallery-clearance-check: ${baseline ? 'baseline recorded' : 'all passed'}; screenshots: ${shots}`);
