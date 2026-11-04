// Synthetic journal → UI mirror, then actual built-page controls. No model or live service.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uiServer } from './ui-server.mjs';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

const dir = mkdtempSync(join(tmpdir(), 'e2a2o-agreement-check-'));
execFileSync('cargo', ['test', '--quiet', 'asks_agreement_two_speakers_restart_and_mirror_fixture'], {
  cwd: new URL('../core', import.meta.url).pathname,
  env: { ...process.env, E2A2O_AGREEMENT_FIXTURE_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit'],
});
const fixture = JSON.parse(readFileSync(join(dir, 'agreement.json'), 'utf8'));
globalThis.location = new URL('http://localhost/');
const server = await uiServer();
try {
  const { apply } = await server.ssrLoadModule('/src/core.ts');
  const { BUILT_INS, builtInOn } = await server.ssrLoadModule('/src/shell/features.ts');
  assert.equal(BUILT_INS.find(b => b.id === 'explicit-agreement').defaultOn, false);
  assert.equal(builtInOn('explicit-agreement'), false);
  let world = fixture.initial;
  assert.deepEqual(world.agreements.p1.agreed_by, []);
  fixture.changes.forEach((change, i) => {
    world = apply(world, change);
    assert.deepEqual(JSON.parse(JSON.stringify(world)), fixture.worlds[i], `Rust/UI mirror after acknowledgment ${i}`);
    assert.equal(fixture.receipts[i].ok, true);
  });
  assert.deepEqual(world.agreements.p1.agreed_by, ['B']);
  assert.deepEqual(apply(world, fixture.changes[0]), world, 'late duplicate cannot undo withdrawal');
  assert.deepEqual(apply(world, { ...fixture.changes[0], revision: 'stale' }), world);
  assert.deepEqual(apply(world, { type: 'thought_decided', thought_id: 'p1', decided: true }).agreements, world.agreements);
  assert.deepEqual(apply(world, { type: 'messages_read', keys: ['synthetic'] }).agreements, world.agreements);
  console.log('PASS agreement mirror: two speakers, duplicate/stale rejection, read/decision independence, default off');
} finally { await server.close(); }

const unavailable = ready();
if (unavailable) { console.log(`SKIP agreement page: ${unavailable}`); process.exitCode = 3; }
else {
  const core = await standInCore(() => [{ type: 'snapshot', world: fixture.world }]);
  let browser;
  try {
    browser = await openPage('about:blank', { width: 1440, height: 900 });
    const { page, evaluate, until } = browser;
    await page('Page.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('e2a2o.toured','1');window.errors=[];addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver'))errors.push(e.message)});` });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
    const populated = await until(`!!document.querySelector('.spine-ready [data-thought="p1"]')`, 10000);
    if (!populated) {
      const screenshot = await page('Page.captureScreenshot', { format:'png' });
      writeFileSync(join(dir, 'initial-page.png'), Buffer.from(screenshot.data,'base64'));
      console.log('Page diagnostic', await evaluate(`JSON.stringify({text:document.body.innerText.slice(0,1800),errors:window.errors,classes:Array.from(document.querySelectorAll('[class*=spine]')).slice(0,8).map(e=>e.className)})`));
      console.log(`Diagnostic screenshot: ${join(dir, 'initial-page.png')}`);
    }
    assert.ok(populated, 'built page renders the synthetic thought');
    assert.equal(await evaluate(`document.querySelectorAll('.spine-agreement-controls').length`), 0);
    const key = async (key, code, n) => { for (const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode:n, ...(type === 'keyDown' && key === 'Enter' ? { text:'\r' } : {}) }); };
    const click = async selector => {
      const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), `reachable ${selector}`);
      for (const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...p, button:'left', clickCount:1 });
    };
    const toggle = async () => {
      await key('c','KeyC',67);
      assert.ok(await until(`!!document.querySelector('[data-row="explicit-agreement"] button[role="switch"]')`));
      await click('[data-row="explicit-agreement"] button[role="switch"]');
      await key('Escape','Escape',27); await sleep(150);
    };
    await toggle();
    assert.ok(await until(`!!document.querySelector('.spine-agreement-disclosure')`));
    assert.ok(core.heard.some(m => m.type === 'agreement_switch' && m.on === true));
    const open = async () => {
      // Existing point focus reveals its control host. Enter opens the native disclosure.
      await evaluate(`document.querySelector('.spine-aside-face, .spine-point .spine-text').focus();document.querySelector('.spine-agreement-disclosure').focus()`);
      await key('Enter','Enter',13);
      assert.ok(await until(`!!document.querySelector('.spine-agreement-panel:popover-open')`));
    };
    await open();
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.spine-agreement-panel li'),e=>e.textContent)`), ['B']);
    assert.equal(core.heard.filter(m => m.type === 'agree_thought').length, 0, 'viewing does not consent');
    await click('[data-agreement-source="p1"] button');
    assert.ok(await until(`document.querySelector('[data-agreement-source="p1"] button')?.disabled`));
    for (let i = 0; i < 40 && !core.heard.some(m => m.type === 'agree_thought'); i++) await sleep(25);
    assert.ok(await until(`!!document.querySelector('.spine-agreement-panel:popover-open')`), 'disclosure stays open while saving');
    const request = core.heard.find(m => m.type === 'agree_thought');
    assert.ok(request && request.agree === true && !('speaker' in request));
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.spine-agreement-panel li'),e=>e.textContent)`), ['B'], 'pending is never optimistic consent');
    core.send({ type:'change', change:{ type:'thought_agreement', thought_id:'p1', revision:request.revision, request_id:request.request_id, speaker:'you', agree:true } });
    core.send({ type:'agreement_result', thought_id:'p1', request_id:request.request_id, ok:true, message:'Agreement saved.' });
    assert.ok(await until(`document.querySelector('[data-agreement-source="p1"] button')?.textContent==='Withdraw my agreement' && !document.querySelector('[data-agreement-source="p1"] button')?.disabled`));
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.spine-agreement-panel li'),e=>e.textContent)`), ['B','you']);
    const shots = process.env.SHOTS ?? join(dir, 'screenshots'); mkdirSync(shots, { recursive:true });
    const shot = async name => { const s = await page('Page.captureScreenshot', { format:'png' }); writeFileSync(join(shots,name), Buffer.from(s.data,'base64')); };
    await shot('asks-agreement-desktop.png');
    await page('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:false }); await sleep(200);
    assert.ok(await evaluate(`(()=>{const r=document.querySelector('.spine-agreement-panel:popover-open').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`), '390px disclosure fits');
    await shot('asks-agreement-390.png');
    await click('[data-agreement-source="p1"] button');
    for (let i = 0; i < 40 && core.heard.filter(m => m.type === 'agree_thought').length < 2; i++) await sleep(25);
    const withdraw = core.heard.filter(m => m.type === 'agree_thought').at(-1);
    assert.equal(withdraw.agree, false);
    await key('Escape','Escape',27);
    assert.ok(await until(`!document.querySelector('.spine-agreement-panel:popover-open')`), 'Escape closes the disclosure');
    await toggle();
    assert.equal(await evaluate(`document.querySelectorAll('.spine-agreement-controls').length`), 0, 'off removes controls and disclosures');
    core.send({ type:'change', change:{ type:'thought_agreement', thought_id:'p1', revision:withdraw.revision, request_id:withdraw.request_id, speaker:'you', agree:false } });
    core.send({ type:'agreement_result', thought_id:'p1', request_id:withdraw.request_id, ok:true, message:'Late success must not show' });
    await sleep(100);
    await toggle(); await open();
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.spine-agreement-panel li'),e=>e.textContent)`), ['B'], 'off retains shared agreement records');
    assert.ok(!await evaluate(`document.querySelector('.spine-agreement-panel').textContent.includes('Late success')`), 'late acknowledgment discarded');
    assert.deepEqual(await evaluate('window.errors'), []);
    console.log(`PASS agreement page: actual keyboard/mouse controls, pending/ack, identities, withdraw, off/late result; screenshots ${shots}`);
  } catch (error) {
    if (browser) {
      const diagnostic = await browser.page('Page.captureScreenshot', { format:'png' }).catch(() => null);
      if (diagnostic) writeFileSync(join(dir,'interaction-failure.png'), Buffer.from(diagnostic.data,'base64'));
      console.log('Heard message types', core.heard.map(m=>m.type));
      console.log('Interaction diagnostic', await browser.evaluate(`JSON.stringify({text:document.body.innerText.slice(0,1800),errors:window.errors})`).catch(() => 'page unavailable'));
      console.log(`Interaction screenshot: ${join(dir,'interaction-failure.png')}`);
    }
    throw error;
  } finally { await browser?.close(); core.close(); }
}
