// Focused built-page fixture using the existing headless helpers. Delete/Move/Undo responses below are scripted;
// the real Rust routing is traced statically, not executed. No microphone, native effects, model or real profile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

const moves = readFileSync(new URL('../core/src/moves.rs', import.meta.url), 'utf8');
const deletion = moves.slice(moves.indexOf('pub(crate) fn delete_said'), moves.indexOf('/// The point\'s Delete'));
assert.match(deletion, /this_thought\(core, &world, speaker\)/);
const typedMove = moves.slice(moves.indexOf("fn that<'a>"), moves.indexOf('fn move_that('));
assert.match(typedMove, /catalog::pointed_at\(core, world, speaker\)/);
assert.match(typedMove, /newest\(world, now, \|t\| on\(world, t, &card\)\)/);
assert.doesNotMatch(typedMove, /this_thought/);
const why = ready();
if (why) { console.error(`wb-map-check: ${why} (Rust routing trace passed)`); process.exit(3); }

const at = Date.now() - 120_000;
const thread = (id, title) => ({ id, title, parent_id: null, status: 'open', last_point: '', touched_ms: at,
  tags: [], picture: null, dropped_by: '' });
const thought = (id, text, thread_id, n) => ({ id, text, point: text, thread_id, speaker: 'you', at_ms: at + n * 1000,
  placed: true, complete: true, unclear: '', guess: '', heard: '', fixed: '', decided: false });
const initial = {
  threads: [thread('T1', 'Garden plan'), thread('T2', 'Weekend plan')],
  thoughts: [thought('a-head', 'Older idea begins', 'T1', 1), thought('a-terminal', 'Older idea joined in full', 'T1', 2),
    thought('b', 'Newer garden idea', 'T1', 3), thought('c', 'One separate idea', 'T2', 4)],
  notes: { 'a-terminal': { continues: 'a-head' } },
  active: 'T1', active_by: { you: 'T1' }, positions: {}, suggestions: [], actions: [], merged: {}, apps: [],
  apps_seeded: true, recaps: [], proposals: [], topics: {},
};
let world = structuredClone(initial), away = false, attention = {}, expected = null, undo = null, fixtureError = null;
const operations = [];
const core = await standInCore(() => away ? null : [{ type: 'snapshot', world }], { onMessage: message => {
  try {
    if (message.type === 'attention') attention = message;
    if (message.type === 'text') {
      assert.ok(expected, 'only the requested fixture command runs');
      assert.equal(message.text, expected.text);
      assert.equal(attention.point, 'a-terminal', 'attention addresses the displayed joined idea, not its layout head');
      assert.equal(attention.selected ?? attention.pointed, 'T1', 'point identity retains thread attention');
      assert.equal(attention.selected, expected.pointer ? null : 'T1');
      undo = structuredClone(world);
      if (message.text === 'delete this') {
        // Script the response for A only, after verifying the actual attention sent by the built UI.
        world.thoughts = world.thoughts.filter(t => !['a-head', 'a-terminal'].includes(t.id));
        for (const thought_id of ['a-head', 'a-terminal']) core.send({ type: 'change', change: { type: 'thought_skipped', thought_id } });
        operations.push('delete A');
      } else {
        // Existing typed Move uses the newest point in T1 (B), never the focused point (A).
        const newest = world.thoughts.filter(t => t.thread_id === 'T1').at(-1);
        assert.equal(newest.id, 'b');
        newest.thread_id = 'T2';
        core.send({ type: 'change', change: { type: 'thought_moved', thought_id: 'b', thread_id: 'T2', from: 'T1' } });
        operations.push('move B');
      }
      core.send({ type: 'notice', message: operations.at(-1) });
      core.send({ type: 'undoable', id: operations.length });
      expected = null;
    }
    if (message.type === 'undo') {
      assert.ok(undo, 'fixture has one operation to undo');
      world = undo; undo = null;
      core.send({ type: 'snapshot', world });
      core.send({ type: 'notice', message: 'Restored fixture idea' });
    }
  } catch (error) { fixtureError = error; }
} });
let browser;
try {
  browser = await openPage('about:blank');
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('e2a2o.toured', '1'); window.wbErrors = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], cancel() {}, addEventListener() {}, removeEventListener() {},
      speak(u) { queueMicrotask(() => u.onend?.()); }
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) wbErrors.push(e.message); });
    addEventListener('unhandledrejection', e => wbErrors.push(String(e.reason)));
  ` });
  // The existing classic composer is the form.composer path retained by watchAttention; do not change that policy.
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?shell=1` });
  const check = async (expression, message) => assert.ok(await until(expression, 10_000), message);
  const key = async (key, code, vk, text) => {
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code,
      windowsVirtualKeyCode: vk, ...(type === 'keyDown' && text ? { text } : {}) });
  };
  const enter = () => key('Enter', 'Enter', 13, '\r');
  const a = '[data-id="p:a-head"] .spine-text';
  const b = '[data-id="p:b"] .spine-text';
  const composer = 'form.composer textarea';
  const field = '.spine-reply-field';
  await check(`!!document.querySelector('.spine-ready') && !!document.querySelector(${JSON.stringify(a)}) && !!document.querySelector(${JSON.stringify(composer)})`, 'Canvas and composer mount');
  await check(`!!document.querySelector(${JSON.stringify(b)})`, 'older A and newer B are both rendered');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(a)}).closest('[data-thought]').dataset.thought`), 'a-head');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(a)}).closest('[data-command-thought]').dataset.commandThought`), 'a-terminal');
  assert.equal(await evaluate(`document.querySelector('.spine-aside[data-thread="T2"]').dataset.commandThought`), 'c', 'single-thought aside has an explicit target');
  assert.equal(await evaluate(`!!document.querySelector('.spine-head[data-command-thought]')`), false, 'thread headers are not point commands');

  // Real actions.annotate returns false while disconnected. The failure notice must not unmount Reply.
  await key('Tab', 'Tab', 9);
  await evaluate(`document.querySelector(${JSON.stringify(b)}).focus()`);
  await key('r', 'KeyR', 82, 'r');
  await check(`document.activeElement === document.querySelector('${field}')`, 'R opens and focuses the margin reply');
  const draft = '  Keep exact  spacing  ';
  await page('Input.insertText', { text: draft });
  await evaluate(`void (window.wbField = document.querySelector('${field}'))`);
  away = true; core.drop();
  await sleep(250);
  await enter();
  await check(`document.body.textContent.includes('Not connected')`, 'existing failure notice appears');
  assert.equal(await evaluate(`document.querySelector('${field}') === wbField && wbField.value === ${JSON.stringify(draft)} && document.activeElement === wbField`), true,
    'false keeps the exact mounted field, draft and focus');
  assert.equal(core.heard.filter(m => m.type === 'annotate').length, 0, 'false sends no annotation');
  away = false;
  for (let n = 0; n < 200 && !core.connected(); n++) await sleep(50);
  assert.equal(core.connected(), 1, 'fixture reconnects');
  assert.equal(await evaluate(`document.querySelector('${field}') === wbField && wbField.value === ${JSON.stringify(draft)} && document.activeElement === wbField`), true, 'reconnect retains the same draft');
  await enter();
  await check(`!document.querySelector('${field}') && getSelection().toString() === ''`, 'true closes and clears selection normally');
  await sleep(100);
  assert.deepEqual(core.heard.filter(m => m.type === 'annotate'), [{ type: 'annotate', thought_id: 'b', quote: 'Newer garden idea', text: draft.trim() }],
    'one resubmission sends exactly one trimmed annotation; no annotation receipt is simulated');

  const focusA = async () => {
    await key('Tab', 'Tab', 9);
    await evaluate(`document.querySelector(${JSON.stringify(a)}).focus()`);
    await sleep(100);
    assert.equal(attention.selected, 'T1');
    assert.equal(attention.point, 'a-terminal');
  };
  const command = async (text, pointer = false) => {
    expected = { text, pointer };
    await evaluate(`document.querySelector(${JSON.stringify(composer)}).focus()`);
    await page('Input.insertText', { text });
    await enter();
    for (let n = 0; n < 100 && expected && !fixtureError; n++) await sleep(50);
    if (fixtureError) throw fixtureError;
    assert.equal(expected, null, 'typed command reached the fixture');
  };
  const restore = async () => {
    await check(`!!document.querySelector('button.undo:not(:disabled)')`, 'Undo is available');
    await evaluate(`document.querySelector('button.undo:not(:disabled)').click()`);
    await check(`!!document.querySelector(${JSON.stringify(a)}) && document.querySelector(${JSON.stringify(b)})?.closest('[data-thread]').dataset.thread === 'T1'`, 'Undo restores A and B on their original thread');
  };
  await focusA();
  await command('delete this');
  await check(`!document.querySelector(${JSON.stringify(a)}) && !!document.querySelector(${JSON.stringify(b)})`, 'keyboard Delete removes only displayed A');
  assert.deepEqual(world.thoughts.map(t => t.id), ['b', 'c']);
  await restore();

  await focusA();
  await command('Move that to Weekend plan');
  await check(`!!document.querySelector(${JSON.stringify(a)}) && document.querySelector(${JSON.stringify(b)})?.closest('[data-thread]').dataset.thread === 'T2'`, 'same selected thread typed Move still moves newest B');
  await restore();

  // Clear held keyboard attention, then repeat once with the pointer on A and keyboard entry in the composer.
  await evaluate(`document.querySelector(${JSON.stringify(composer)}).focus()`);
  await key('Escape', 'Escape', 27);
  await evaluate('document.activeElement?.blur()');
  const target = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(a)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  assert.ok(target.x > 0 && target.x < 1440 && target.y > 0 && target.y < 900, 'A is visible for pointer attention');
  await page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target });
  await sleep(100);
  assert.equal(attention.selected, null);
  assert.equal(attention.pointed, 'T1');
  assert.equal(attention.point, 'a-terminal');
  await command('delete this', true);
  await check(`!document.querySelector(${JSON.stringify(a)}) && !!document.querySelector(${JSON.stringify(b)})`, 'pointer Delete removes only displayed A');
  await restore();
  assert.deepEqual(world, initial, 'all scripted operations are undone');
  await key('Tab', 'Tab', 9);
  await evaluate(`(() => {
    const card = document.createElement('section'); card.className = 'thread'; card.id = 'thread-cards-fixture';
    const point = document.createElement('li'); point.id = 'point-cards-idea'; point.tabIndex = 0;
    card.append(point); document.body.append(card); point.focus(); window.wbCards = card;
  })()`);
  await sleep(100);
  assert.equal(attention.selected, 'cards-fixture');
  assert.equal(attention.point, 'cards-idea', 'existing Cards li selector still supplies point identity');
  await evaluate('wbCards.remove()');
  assert.deepEqual(await evaluate('wbErrors'), [], 'no browser errors');
  console.log('wb-map-check: ok (reply retention/send; joined A keyboard+pointer Delete/Undo; thread-based B Move/Undo; scripted core, static Rust trace)');
} finally {
  await browser?.close();
  core.close();
}
