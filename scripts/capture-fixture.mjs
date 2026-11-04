// Public synthetic captures through the real page and transport; no model service.
import assert from 'node:assert/strict';
import { standInCore, openPage } from './headless.mjs';
export const empty = () => ({ threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {} });
export async function captureCore({ key = true, delay = 2600, seed = empty() } = {}) {
  const state = { world: structuredClone(seed), failSave: false, loseReceipt: false, omitCaptureReceipt: false, reject: false, accepted: new Map(), commits: new Map() };
  const send = change => core.send({ type: 'change', change });
  const receipt = (capture, replay = false) => { if (!state.omitCaptureReceipt) core.send({ type: 'capture_saved', capture, replay }); if (!state.loseReceipt) core.send({ type: 'text_received', id: capture.id }); };
  const place = id => {
    const capture = state.accepted.get(id), thought = state.world.thoughts.find(t => t.id === capture?.thought_ids[0]);
    if (!thought || thought.placed) return;
    const now = Date.now(), threadId = state.world.active ?? 'T1';
    let thread = state.world.threads.find(t => t.id === threadId);
    if (!thread) {
      thread = { id: threadId, title: 'Cooking class', parent_id: null, status: 'open', last_point: '', touched_ms: now, tags: [], picture: null, dropped_by: '' };
      state.world.threads.push(thread); send({ type: 'thread_added', thread });
    }
    Object.assign(thought, { placed: true, thread_id: threadId, point: thought.text, place_ms: delay });
    state.world.active = threadId; state.world.active_by.you = threadId;
    state.commits.set(id, (state.commits.get(id) ?? 0) + 1);
    send({ type: 'thought_placed', thought_id: thought.id, thread_id: threadId, point: thought.text, complete: true, unclear: '', place_ms: delay });
    send({ type: 'thread_touched', thread_id: threadId, last_point: thought.text, at_ms: now });
    send({ type: 'active_changed', thread_id: threadId, speaker: 'you' });
    core.send({ type: 'placing', now: null, retries: [] });
  };
  const core = await standInCore(() => [{ type: 'map_identity', id: 'capture-fixture' }, ...[...state.accepted.values()].map(capture => ({ type: 'capture_saved', capture, replay: true })), { type: 'snapshot', world: state.world }, ...(!key ? [{ type: 'notice', message: 'MODEL_API_KEY is not set: listening and placement are off.' }] : [])], {
    door: { room: false, member: true, sample: true, samples: [{ id: 'student-week', label: "A student's week" }, { id: 'debug-break', label: 'A bug, then a call' }] },
    onMessage(message) {
      if (message.type === 'heartbeat') { core.send(message); return; }
      if (message.type === 'retry_placement') { const capture = [...state.accepted.values()].find(c => c.thought_ids.includes(message.id)); if (capture && key) setTimeout(() => place(capture.id), 100); return; }
      if (message.type !== 'text') return;
      if (state.failSave) { core.send({ type: 'notice', message: "Couldn't save. Keep this window open; recent changes may be lost when you restart." }); return; }
      const existing = state.accepted.get(message.id);
      if (existing) { receipt(existing); return; }
      const thought = { id: `th-${message.id}`, speaker: 'you', text: message.text, point: '', thread_id: state.world.active, placed: false, unclear: '', guess: '', heard: '', fixed: '', complete: true, at_ms: Date.now(), place_ms: null, decided: false };
      const capture = { id: message.id, text: message.text, thought_ids: [thought.id] };
      state.accepted.set(message.id, capture); state.world.thoughts.push(thought);
      send({ type: 'thought_added', thought }); receipt(capture);
      if (key && !state.reject) { core.send({ type: 'placing', now: thought.id, retries: [] }); setTimeout(() => place(message.id), delay); }
      if (key && state.reject) core.send({ type: 'placing', now: null, retries: [{ thought_id: thought.id, in_ms: 1000 }] });
    },
  });
  return Object.assign(core, { state, place });
}
export async function capturePage(core, { width = 1440, height = 900, scheme = 'light', reduced = false, tour = true } = {}) {
  const browser = await openPage('about:blank', { width, height });
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until('!!document.querySelector("#type-a-thought")', 10000), 'composer mounts');
  if (tour) { assert.equal(await evaluate('localStorage.getItem("e2a2o.toured")'), null, 'no tour bypass flag in the fresh profile'); if (!core.state.world.threads.length) assert.ok(await until('!!document.querySelector("[data-map-capture=active]")'), 'the empty map offers capture in place'); }
  await evaluate('document.fonts.ready.then(() => true)');
  return browser;
}
export async function typeCapture(browser, text) {
  const { page, evaluate } = browser;
  await evaluate('document.querySelector("#type-a-thought").focus()');
  await page('Input.insertText', { text });
  for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
}
