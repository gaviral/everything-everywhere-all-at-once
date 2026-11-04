// Synthetic contracts and mounted UI only. Production services and personal journals are never used.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uiServer } from './ui-server.mjs';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

async function main() {
const thread = { id: 'synthetic-topic', title: 'Synthetic rehearsal', parent_id: null, status: 'open', last_point: '', touched_ms: 100, tags: [], picture: null, dropped_by: '' };
const thought = id => ({ id, speaker: 'you', text: `Original words for ${id}.`, point: 'Synthetic phrase', thread_id: thread.id, placed: true, unclear: '', complete: true, at_ms: 100, place_ms: 200 });
let world = { threads: [thread], thoughts: [thought('first'), thought('second')], active: thread.id, active_by: { you: thread.id }, suggestions: [], actions: [], merged: {}, proposals: [], recaps: [], apps: [], apps_seeded: true, notes: {} };
globalThis.location = new URL("http://fixture.invalid/");
const server = await uiServer();
let apply, sourceRevision, answerSourceState, saved;
try {
  ({ apply, sourceRevision, answerSourceState } = await server.ssrLoadModule('/src/core.ts'));
  const { BUILT_INS } = await server.ssrLoadModule('/src/shell/features.ts');
  assert.equal(BUILT_INS.find(b => b.id === 'saved-answers').defaultOn, false);
  const source = { thought_id: 'second', field: 'point', excerpt: world.thoughts[1].point, revision: sourceRevision(world.thoughts[1]) };
  saved = { id: 'served-synthetic-answer', source, phrase: 'Synthetic phrase', answer: 'The exact retained answer from the synthetic fixture.', model: 'fixture-actual-model', owner: 'you', at_ms: 100, revision: 1, removed: false };
  const kept = apply(world, { type: 'answer_kept', answer: saved });
  assert.equal(answerSourceState(kept, source), 'available');
  assert.deepEqual(apply(kept, { type: 'answer_kept', answer: saved }), kept, 'replay idempotence');
  const changed = apply(kept, { type: 'thought_repointed', thought_id: 'second', point: 'Changed source' });
  assert.equal(answerSourceState(changed, source), 'changed');
  const missing = apply(kept, { type: 'thought_skipped', thought_id: 'second' });
  assert.equal(answerSourceState(missing, source), 'missing', 'never jump to the same-text first sibling');
  assert.equal(missing.kept_answers[0].source.excerpt, 'Synthetic phrase');
  assert.equal(apply(kept, { type: 'kept_answer_visibility', id: saved.id, revision: 9, removed: true }).kept_answers[0].removed, false);
  let removed = apply(kept, { type: 'kept_answer_visibility', id: saved.id, revision: 2, removed: true });
  assert.equal(removed.kept_answers[0].removed, true);
  removed = apply(removed, { type: 'kept_answer_visibility', id: saved.id, revision: 3, removed: false });
  assert.equal(removed.kept_answers[0].answer, saved.answer);
  let bounded = world;
  for (let i = 0; i < 31; i++) bounded = apply(bounded, { type: 'answer_kept', answer: { ...saved, id: `bounded-${i}` } });
  assert.equal(bounded.kept_answers.length, 30);
  assert.equal(apply(world, { type: 'answer_kept', answer: { ...saved, answer: 'é'.repeat(1025) } }), world, 'UTF-8 byte limit');
} finally { await server.close(); }
if (ready()) { console.log(`SKIP asks-kept-answers mounted UI: ${ready()} (contracts passed)`); process.exit(3); }

let calls = 0;
const served = new Map();
const core = await standInCore(() => [{ type: 'snapshot', world }], { onMessage(message) {
  if (message.type === 'explain') {
    calls++;
    served.set(message.id, { ...saved, id: message.id, source: message.source });
    core.send({ type: 'explanation', id: message.id, text: saved.answer, failed: false });
  } else if (message.type === 'keep_answer') {
    const answer = served.get(message.id);
    if (!answer?.source) throw Error('Keep did not carry a served source');
    const change = { type: 'answer_kept', answer };
    world = apply(world, change); core.send({ type: 'change', change });
  } else if (message.type === 'kept_answer_visibility') {
    const change = { ...message, revision: message.revision + 1 };
    world = apply(world, change); core.send({ type: 'change', change });
  } else if (message.type === 'focus') {
    core.send({ type: 'change', change: { type: 'active_changed', thread_id: message.thread_id, speaker: 'you' } });
  }
} });
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), 'asks-kept-layouts-'));
mkdirSync(shots, { recursive: true });
let scene;
try {
  scene = await openPage(`http://127.0.0.1:${core.port}/`);
  const { page, evaluate, until } = scene;
  const clickText = text => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b)throw Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`);
  const feature = async () => { await evaluate(`document.querySelector('[data-guide="catalog"]').click()`); assert.ok(await until(`!!document.querySelector('[data-row="saved-answers"]')`)); };
  const toggle = () => evaluate(`document.querySelector('[data-row="saved-answers"] [role="switch"]').click()`);
  const closeRail = () => evaluate(`document.querySelector('.shell-rail-close')?.click()`);
  const selectSecond = async () => {
    await evaluate(`(() => {const e=document.querySelector('[data-thought="second"] .spine-text');const r=e.getBoundingClientRect();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);
    assert.ok(await until(`!!document.querySelector('[data-thought="second"].spine-selecting')`), 'Canvas text selection mode');
    await evaluate(`(() => {
      const host=document.querySelector('[data-thought="second"]');
      const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT); let node;
      while(node=walker.nextNode()) { const at=node.textContent.indexOf('Synthetic phrase'); if(at<0)continue;
        const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+16);
        const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
        document.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));return;
      } throw Error('Exact second source missing');
    })()`);
    const picked = await until(`!!document.querySelector('.explain > button')`);
    if (!picked) {
      console.log(await evaluate(`(() => {const s=getSelection();const r=s.rangeCount?s.getRangeAt(0):null;let e=r?.commonAncestorContainer; if(e?.nodeType!==1)e=e?.parentElement;return {selected:s.toString(),parent:e?.className,inMap:!!e?.closest('.map,.spine'),rect:r?.getBoundingClientRect().toJSON(),ceilings:[...document.querySelectorAll('header,.map-tools')].map(e=>e.getBoundingClientRect().bottom)};})()`));
      await screenshot('selection-failure.png');
    }
    assert.ok(picked, 'Explain selection');
    await evaluate(`document.querySelector('.explain > button').click()`);
    assert.ok(await until(`document.querySelector('.explain-card')?.textContent.includes('exact retained answer')`));
  };
  const screenshot = async name => { const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(shots, name), Buffer.from(data, 'base64')); };
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 15000));
  await sleep(600);
  await feature();
  assert.equal(await evaluate(`document.querySelector('[data-row="saved-answers"] [role="switch"]').getAttribute('aria-checked')`), 'false');
  await closeRail();
  await selectSecond();
  assert.equal(await evaluate(`[...document.querySelectorAll('.explain button')].some(b=>b.textContent==='Keep')`), false);
  assert.equal(core.heard.some(m => m.type === 'keep_answer' || m.type === 'saved_answers'), false, 'off sends no saved requests; Explain still works');
  await evaluate(`document.querySelector('[aria-label="Dismiss explanation"]').click();getSelection().removeAllRanges()`);
  await feature(); await toggle(); await closeRail();
  assert.ok(await until(`!!document.querySelector('[aria-label="Saved answers"]')`));
  await clickText('Close');
  await selectSecond(); await clickText('Keep');
  assert.ok(await until(`document.querySelector('.explain-card')?.textContent.includes('Saved')`));
  assert.equal(world.kept_answers[0].source.thought_id, 'second');
  const callsAfterKeep = calls;
  await evaluate(`document.querySelector('[aria-label="Dismiss explanation"]').click()`);
  // Reconnect with a snapshot, exactly as a late-joining browser receives retained World data.
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('[aria-label="Saved answers"]')`, 15000));
  assert.ok(await until(`!!document.querySelector('.spine-ready')`, 15000), 'Canvas mounted behind reopened card');
  await clickText('Synthetic phrase');
  assert.ok(await until(`!!document.querySelector('[aria-label="Historical answer"]')`));
  assert.equal(calls, callsAfterKeep, 'reopen makes zero Explain calls');
  await screenshot('saved-answers-desktop.png');
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(500); await screenshot('saved-answers-390.png');
  assert.ok(await evaluate(`(() => { const r=document.querySelector('[aria-label="Saved answers"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`), '390px card within viewport');
  await clickText('Jump to source');
  assert.ok(await until(`!document.querySelector('[aria-label="Saved answers"]')`));
  assert.equal(calls, callsAfterKeep);
  assert.ok(core.heard.some(m => m.type === 'focus' && m.thread_id === thread.id));
  assert.ok(await until(`document.querySelector('[data-thought="second"] .spine-text')?.textContent.includes('Original words for second.')`, 15000), 'jump opens the exact second source original');
  assert.equal(await evaluate(`document.querySelector('[data-thought="first"] .spine-text')?.textContent.includes('Original words for first.')`), false, 'same-text sibling is not the jump target');
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await feature();
  await evaluate(`document.querySelector('[data-row="saved-answers"] button:not([role="switch"])')?.click()`);
  // The Catalog's Show button is the stable route back into the list.
  if (!await evaluate(`!!document.querySelector('[aria-label="Saved answers"]')`)) await clickText('Show');
  await closeRail(); await clickText('Synthetic phrase');
  await clickText('Remove saved answer');
  assert.ok(await until(`document.querySelector('[aria-label="Saved answers"]')?.textContent.includes('Undo removal')`));
  await clickText('Undo removal');
  assert.ok(await until(`!!document.querySelector('[aria-label="Historical answer"]')`));
  const change = { type: 'thought_repointed', thought_id: 'second', point: 'Changed source' };
  world = apply(world, change); core.send({ type: 'change', change });
  assert.ok(await until(`document.querySelector('[aria-label="Historical answer"]')?.textContent.includes('Source changed')`));
  await screenshot('saved-answers-changed.png');
  const deletion = { type: 'thought_skipped', thought_id: 'second' };
  world = apply(world, deletion); core.send({ type: 'change', change: deletion });
  assert.ok(await until(`document.querySelector('[aria-label="Historical answer"]')?.textContent.includes('Source no longer available')`));
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Jump to source').disabled`));
  await clickText('Close'); await feature(); await toggle(); await closeRail();
  assert.ok(await until(`!document.querySelector('[aria-label="Saved answers"]')`));
  assert.equal(world.kept_answers.filter(a => !a.removed).length, 1, 'disable retains saved data');
  assert.equal(calls, callsAfterKeep);
  console.log('asks-kept-answers-check: contracts + enable/Keep/reopen/jump/history/remove/Undo/disable + desktop/390 screenshots passed; synthetic only');
} finally { await scene?.close(); core.close(); }

}
main().catch(error => { console.error(`asks-kept-answers-check: ${error.message}`); process.exitCode = 1; });
