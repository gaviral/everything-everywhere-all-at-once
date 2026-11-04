// Closed hub/real UI, synthetic service receipts only. Never accesses a local account.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uiServer } from './ui-server.mjs';
import { openPage, ready, standInCore } from './headless.mjs';
const server = await uiServer();
try {
  const { canConfirm } = await server.ssrLoadModule('/src/bricks/app-connections/rules.ts');
  const plan = { steps: [{ state: 'proposed' }, { state: 'proposed' }, { state: 'proposed' }] };
  assert.equal(canConfirm(plan, 0), true); assert.equal(canConfirm(plan, 1), false);
  plan.steps[0].state = 'done'; assert.equal(canConfirm(plan, 1), true);
  plan.steps[1].state = 'failed'; assert.equal(canConfirm(plan, 1), false); assert.equal(canConfirm(plan, 2), false);
} finally { await server.close(); }
if (process.argv.includes('--modules-only')) { console.log('app-connections modules: passed'); process.exit(0); }
assert.ok(['1', 'all'].includes(process.env.PRECHECK_PAGES), 'run with PRECHECK_PAGES=1 or all');
assert.equal(ready(), '', 'built UI and Chrome required');
const artifacts = mkdtempSync(join(tmpdir(), 'e2a2o-app-connections-'));
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, proposals: [], apps: [], apps_seeded: true, questions: [] };
let plan = null, failRead = false;
const fixture = await standInCore(() => [{ type: 'snapshot', world }], { onMessage: m => {
  if (m.type !== 'app_connection') return;
  if (m.operation === 'plan') plan = { id: 'synthetic-plan', source: 'You', block: m.block, title: null, steps: [
    { name: 'Read Reminders', detail: 'Read the first matching title from the E2A2O list.', state: 'proposed' },
    { name: 'Add to Calendar', detail: 'Add an all-day event on the selected date.', state: 'proposed' },
    { name: 'Play tune', detail: 'Play in this browser.', state: 'proposed' },
  ] };
  if (m.operation === 'confirm') {
    assert.ok(plan); assert.equal(plan.steps[m.step].state, 'proposed'); assert.ok(plan.steps.slice(0, m.step).every(s => s.state === 'done'));
    plan.steps[m.step].state = failRead ? 'failed' : 'done';
    plan.steps[m.step].detail = failRead ? 'Synthetic permission refusal. Nothing will retry.' : ['Read matching reminder: Pay rent', 'Calendar fixture accepted the all-day event.', 'Tune fixture confirmed.'][m.step];
    if (m.step === 0 && !failRead) { plan.title = 'Pay rent'; plan.steps[1].detail = `Add “Pay rent” · ${plan.block.when} · all day · E2A2O calendar`; }
  }
  if (m.operation === 'dismiss') plan = null;
  fixture.send({ type: 'app_connection_result', request_id: m.request_id, message: 'Synthetic fixture receipt; no external app accessed.', plans: plan ? [structuredClone(plan)] : [], play: m.operation === 'confirm' && m.step === 2 && !failRead });
} });
assert.ok(![4360,4399].includes(fixture.port));
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${fixture.port}/?bricks=app-connections`, { width: 1280, height: 900 });
  const { page, evaluate, until } = browser;
  await page('Runtime.enable');
  const errors = []; browser.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
  assert.ok(await until(`!!document.querySelector('.app-connections > button')`, 10000));
  await evaluate(`document.querySelector('.app-connections > button').click()`);
  assert.ok(await until(`!!document.querySelector('.app-connections form')`));
  const fill = async () => evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    const inputs = document.querySelectorAll('.app-connections input');
    for (const [input,value] of [[inputs[0],'rent'],[inputs[1],'2026-11-06']]) { setter.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); }
  })()`);
  assert.ok(await until(`!document.querySelector('.app-connections form button').disabled`), 'connected before preview');
  await fill();
  await evaluate(`document.querySelector('.app-connections form').requestSubmit()`);
  assert.ok(await until(`document.querySelectorAll('[data-connection-step]').length === 3`));
  assert.equal(fixture.heard.filter(m => m.type === 'app_connection' && m.operation === 'confirm').length, 0, 'preview executes nothing');
  const enabled = () => evaluate(`[...document.querySelectorAll('[data-connection-step] button')].map(b=>!b.disabled)`);
  assert.deepEqual(await enabled(), [true,false,false]);
  const shot = async name => { const image = await page('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts,name+'.png'), Buffer.from(image.data,'base64')); };
  await shot('desktop-proposals');
  for (let step = 0; step < 3; step++) {
    if (step === 0) {
      await evaluate(`document.querySelector('[data-connection-step="0"] button').focus()`);
      assert.equal(await evaluate(`document.activeElement === document.querySelector('[data-connection-step="0"] button')`), true, 'confirmation has keyboard focus');
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else await evaluate(`document.querySelector('[data-connection-step="${step}"] button').click()`);
    assert.ok(await until(`document.querySelector('[data-connection-step="${step}"]').textContent.includes('Receipt received')`), `step ${step} has a receipt`);
    assert.equal(fixture.heard.filter(m => m.type === 'app_connection' && m.operation === 'confirm').length, step + 1);
  }
  await shot('desktop-receipts');
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await shot('phone-receipts');
  await page('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.querySelector('.app-connections-body').scrollWidth <= document.querySelector('.app-connections-body').clientWidth + 1`), true, '320px body has no horizontal overflow');
  await shot('phone-320');
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.querySelector('.app-connections-body').scrollWidth <= document.querySelector('.app-connections-body').clientWidth + 1`), true, 'phone body has no horizontal overflow');
  await evaluate(`document.querySelector('.app-connections-body').style.fontSize='24px'`);
  assert.equal(await evaluate(`document.querySelector('.app-connections-body').scrollWidth <= document.querySelector('.app-connections-body').clientWidth + 1`), true, 'enlarged text stays reachable');
  await shot('phone-enlarged');
  await evaluate(`document.querySelector('.app-connections-body').style.fontSize=''`);
  failRead = true;
  await evaluate(`document.querySelector('.app-connections form').requestSubmit()`);
  assert.ok(await until(`document.querySelector('[data-connection-step="0"] button') !== null`));
  await page('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touch = await evaluate(`(() => { const b = document.querySelector('[data-connection-step="0"] button'); b.scrollIntoView({block:'nearest'}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await until(`document.querySelector('[data-connection-step="0"]').textContent.includes('Stopped')`));
  assert.deepEqual(await enabled(), [false,false]);
  await shot('phone-failure');
  await evaluate(`document.querySelector('.app-connections-body button').focus()`);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.ok(await until(`!document.querySelector('.app-connections-body')`));
  assert.equal(await evaluate(`document.activeElement === document.querySelector('.app-connections > button')`), true, 'Escape restores opener focus');
  await evaluate(`document.querySelector('.app-connections > button').click()`);
  assert.ok(await until(`!!document.querySelector('.app-connections-body')`));
  fixture.drop();
  assert.ok(await until(`document.querySelector('.app-connections-body').textContent.includes('Disconnected')`));
  assert.equal(await evaluate(`[...document.querySelectorAll('.app-connections-body button')].filter(b=>b.textContent!=='Close').every(b=>b.disabled)`), true, 'disconnect disables writes');
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts,'receipts.json'),JSON.stringify({ confirmations: fixture.heard.filter(m=>m.type==='app_connection' && m.operation==='confirm'), errors },null,2));
  console.log(`app-connections-check: passed (synthetic only); artifacts ${artifacts}`);
} catch (error) {
  if (browser) {
    writeFileSync(join(artifacts,'failure.json'), JSON.stringify({ error: String(error), messages: fixture.heard.filter(m=>m.type==='app_connection'), body: await browser.evaluate(`document.querySelector('.app-connections')?.innerText`), focus: await browser.evaluate(`document.activeElement?.outerHTML`) },null,2));
    const image = await browser.page('Page.captureScreenshot', {format:'png'}); writeFileSync(join(artifacts,'failure.png'),Buffer.from(image.data,'base64'));
  }
  console.error(`app-connections failure artifacts ${artifacts}`);
  throw error;
} finally { if (browser) await browser.close(); fixture.close(); }
