// Real same-origin tabs, including an insecure HTTP room guest. No model or key.
import assert from 'node:assert/strict';
import { standInCore, openPage, ready, sleep } from './headless.mjs';
if (ready()) { console.log(`SKIP waiting-tabs-page-check: ${ready()}`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], topics: {} };
let online = true;
const landed = new Map();
const core = await standInCore(() => online ? [{ type: 'snapshot', world }] : null, {
  door: { room: true, member: true },
  onMessage(message) {
    if (message.type !== 'text') return;
    assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    if (!landed.has(message.id)) landed.set(message.id, message.text);
    core.send({ type: 'text_received', id: message.id });
  },
});
assert.ok(core.port >= 4620);
let scene;
try {
  scene = await openPage('about:blank', { chromeArgs: ['--host-resolver-rules=MAP room.test 127.0.0.1', '--no-proxy-server', '--disable-popup-blocking'] });
  const { page, evaluate, until } = scene;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('e2a2o.joined', 'Guest'); localStorage.setItem('e2a2o.name', 'Guest');` });
  const url = `http://room.test:${core.port}/`;
  await page('Page.navigate', { url });
  assert.ok(await until(`!!document.querySelector('textarea')`, 10000), 'HTTP guest joins');
  assert.deepEqual(await evaluate(`[isSecureContext, typeof crypto.randomUUID, typeof crypto.getRandomValues]`), [false, 'undefined', 'function']);
  await evaluate(`window.other = window.open(location.href); true`);
  assert.ok(await until(`!!window.other?.document.querySelector('textarea')`, 10000), 'second tab joins: ' + JSON.stringify(await evaluate(`({ exists: !!other, closed: other?.closed, url: other?.location.href, text: other?.document.body?.textContent?.slice(0, 1000) })`)));
  online = false;
  core.drop();
  assert.ok(await until(`document.body.textContent.includes('Connecting…') && other.document.body.textContent.includes('Connecting…')`), 'both tabs offline');
  const setDraft = (text) => `(() => { const field = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`;
  await evaluate(setDraft('First offline tab keeps its thought'));
  await evaluate(`other.eval(${JSON.stringify(setDraft('Second offline tab keeps its thought'))})`);
  await sleep(100);
  // Both tabs began with an empty in-memory queue; submit without waiting for storage events.
  await evaluate(`document.querySelector('form[data-guide="composer"]').requestSubmit(); other.document.querySelector('form[data-guide="composer"]').requestSubmit();`);
  const saved = `Object.keys(localStorage).filter(k => k.startsWith('e2a2o.waiting.Guest.'))`;
  assert.ok(await until(`${saved}.length === 2`), 'two independent saved entries');
  assert.ok(await until(`document.body.textContent.includes('2 to send when connected') && other.document.body.textContent.includes('2 to send when connected')`), 'both tabs show shared count');
  await evaluate('other.close()');
  await page('Page.navigate', { url: 'about:blank' });
  await page('Page.navigate', { url });
  assert.ok(await until(`document.body.textContent.includes('2 to send when connected')`, 10000), 'both thoughts survive closing both pages');
  await evaluate(`window.other = window.open(location.href); true`);
  assert.ok(await until(`!!other?.document.body.textContent.includes('2 to send when connected')`, 10000), 'second tab reopens with both saved thoughts');
  online = true;
  assert.ok(await until(`${saved}.length === 0`, 20000), 'receipt removes only its own entry');
  assert.deepEqual([...landed.values()].sort(), ['First offline tab keeps its thought', 'Second offline tab keeps its thought']);
  assert.equal(landed.size, 2);
  console.log(`PASS: two offline tabs retain both thoughts across closing and reopening; HTTP room guest sends valid unique ids; Chrome, port ${core.port}`);
} finally {
  await scene?.close();
  core.close();
}
