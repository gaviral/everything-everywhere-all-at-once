// Conversation first, topic membership second: pure layout invariants and the actual Features comparison in Chrome.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { uiServer } from './ui-server.mjs';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

const at = Date.UTC(2026, 10, 3, 12);
const topic = (id, title, parent_id = null) => ({ id, title, parent_id, status: 'open', last_point: '', touched_ms: at, tags: [], picture: null, dropped_by: '' });
const thought = (id, text, thread_id, n, speaker = 'you') => ({ id, text, point: text.slice(0, 24), thread_id, speaker, at_ms: at + n * 1000, placed: !!thread_id, complete: true, unclear: '', place_ms: 0 });
const threads = [topic('room', 'Paint the room'), topic('rent', 'Rent on Friday'), topic('blue', 'Try blue by the window', 'room')];
const thoughts = [
  thought('p1', 'Keep the room light. Let’s look at the paint samples together.', 'room', 1),
  thought('p2', 'One tangent: rent is due Friday. I can send my half tonight.', 'rent', 2, 'Sam'),
  thought('p3', 'Back to the room: try this blue by the window before we decide.', 'blue', 3),
  thought('p4', 'Yes, the blue looks warmer in daylight. Keep both samples until sunset.', 'blue', 4, 'Helper'),
  thought('p5a', 'Keep the walls light.', 'room', 5),
  thought('p5b', 'And set aside the rent tonight.', 'rent', 5),
  thought('p6', 'Let’s leave the ceiling white and test the wall color tomorrow morning.', null, 6, 'Sam'),
];
const input = { threads, thoughts, notes: {}, rooms: new Map(), positions: {}, shelf: new Map(), open: null, me: 'you', speakers: new Map([['Helper', { ai: true }]]) };
const server = await uiServer();
try {
  const { conversationLayout, CONVERSATION } = await server.ssrLoadModule('/src/bricks/spine/conversation.ts');
  const { BUILT_INS, builtInOn } = await server.ssrLoadModule('/src/shell/features.ts');
  assert.equal(BUILT_INS.find(b => b.id === 'conversation-spine').defaultOn, false);
  assert.equal(builtInOn('conversation-spine'), false);
  const before = JSON.stringify(input);
  const result = conversationLayout({ ...input, thoughts: [...thoughts].reverse() });
  // Equal-clock split parts retain source order, so use chronological source order for the split fixture.
  const scene = conversationLayout(input);
  const points = s => s.items.filter(i => i.kind === 'point');
  assert.deepEqual(points(scene).map(i => i.id), ['p1', 'p2', 'p3', 'p4', 'p5a', 'p6']);
  assert.equal(points(result)[0].id, 'p1', 'time order independent of topic order');
  assert.deepEqual(scene.byKey.get('p:p5a').thoughts, ['p5a', 'p5b'], 'one split turn, both parts retained');
  assert.deepEqual(scene.byKey.get('p:p5a').memberships.map(m => m.thread), ['room', 'rent']);
  assert.equal(scene.byKey.get('p:p6').memberships.length, 0, 'unplaced words already on spine');
  assert.equal(scene.tips.get(CONVERSATION), 'p:p6');
  assert.equal(conversationLayout({ ...input, thoughts: thoughts.map(t => t.id === 'p6' ? { ...t, complete: false } : t) }).byKey.get('p:p6').left, false, 'waiting for classification does not claim an unfinished sentence');
  assert.equal(scene.byKey.get('t:blue').parentTopic.thread, 'room');
  assert.equal(scene.links.filter(l => l.key.startsWith('membership:')).length, 6);
  const boxes = s => points(s).map(i => [i.key, i.box]);
  const placed = { ...input, thoughts: thoughts.map(t => t.id === 'p6' ? { ...t, placed: true, thread_id: 'room' } : t) };
  assert.deepEqual(boxes(conversationLayout(placed)), boxes(scene), 'placement cannot move a turn');
  assert.deepEqual(boxes(conversationLayout({ ...placed, open: 'room' })), boxes(scene), 'topic expansion cannot move a turn');
  assert.deepEqual(boxes(conversationLayout({ ...placed, thoughts: placed.thoughts.map(t => t.id === 'p2' ? { ...t, thread_id: 'blue' } : t) })), boxes(scene), 'reclassification cannot move a turn');
  const note = thought('note1', 'Try paper samples next.', 'note', 3.5, 'Helper');
  const withNote = conversationLayout({ ...input, threads: [...threads, { ...topic('note', 'On the samples'), anchor: { thought_id: 'p1', quote: thoughts[0].text } }], thoughts: [...thoughts, note] });
  assert.equal(withNote.byKey.get('p:note1').replyTo, 'p:p1', 'an anchored reply keeps a link to the answered turn');
  assert.deepEqual(points(withNote).map(i => i.id), ['p1','p2','p3','note1','p4','p5a','p6'], 'notes remain chronological turns');
  assert.equal(JSON.stringify(input), before, 'projection never mutates routing or stored words');
  console.log('PASS projection invariants: chronology, split membership, waiting turn, stable placement/expansion/reclassification, no mutation');
} finally { await server.close(); }

const unavailable = ready();
if (unavailable) { console.log(`SKIP spine-conversation-projection-check: ${unavailable}`); process.exit(3); }
const world = { threads, thoughts, active: 'room', active_by: { you: 'room' }, stay_here: null, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: ['Helper'] };
const core = await standInCore(() => [{ type: 'snapshot', world }]);
assert.ok(core.port >= 4620);
let browser;
try {
  browser = await openPage('about:blank', { width: 1440, height: 900 });
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('e2a2o.toured','1'); window.errors=[]; addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});` });
  const url = `http://127.0.0.1:${core.port}/`;
  await page('Page.navigate', { url });
  assert.ok(await until(`!!document.querySelector('.spine-ready .spine-point')`, 10000));
  const geometry = () => evaluate(`JSON.stringify([...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.dataset.id,at:e.style.transform,text:e.textContent})))`);
  const legacy = await geometry();
  assert.equal(await evaluate(`document.querySelectorAll('.spine-conversation-turn').length`), 0, 'off by default');
  const click = async (selector) => {
    await sleep(600); // Let the camera's current glide settle before a physical pointer click.
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.ok(await evaluate(`!!document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})`), `pointer can reach ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const key = async (key, code, n) => {
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n, text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
  };
  const catalog = async () => {
    await key('c', 'KeyC', 67);
    assert.ok(await until(`!!document.querySelector('[data-row="conversation-spine"]')`));
  };
  await catalog();
  const toggle = '[data-row="conversation-spine"] button[role="switch"]';
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')`), 'false');
  await click(toggle);
  await key('Escape', 'Escape', 27);
  assert.ok(await until(`document.querySelectorAll('.spine-conversation-turn').length===6`));
  assert.equal(await evaluate(`document.querySelectorAll('.spine-topic').length`), 3);
  assert.equal(await evaluate(`document.querySelector('[data-thought="p5a"] .spine-words').textContent`), `${thoughts[4].text} ${thoughts[5].text}`);
  assert.equal(await evaluate(`document.querySelector('[data-thought="p6"] .spine-words').textContent`), thoughts[6].text);
  const turnPositions = () => evaluate(`JSON.stringify([...document.querySelectorAll('.spine-conversation-turn')].map(e=>({id:e.dataset.thought,at:e.closest('.react-flow__node').style.transform})))`);
  const originalPositions = await turnPositions();
  await sleep(700);
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1250, y: 220, button: 'left', buttons: 1, clickCount: 1 });
  await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1250, y: 260, button: 'left', buttons: 1 });
  const heldCamera = await evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  core.send({ type: 'change', change: { type: 'thought_placed', thought_id: 'p6', thread_id: 'room', point: 'Test the wall tomorrow', unclear: '', complete: true, place_ms: 0 } });
  assert.ok(await until(`!!document.querySelector('[data-thought="p6"] button[aria-label="Topic: Paint the room"]')`));
  assert.equal(await turnPositions(), originalPositions, 'live classification only changes membership');
  assert.equal(await evaluate(`document.querySelector('.react-flow__viewport').style.transform`), heldCamera, 'classification respects an ongoing pan');
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1250, y: 260, button: 'left', buttons: 0, clickCount: 1 });
  assert.equal(await evaluate(`document.querySelector('[data-thought="p6"] .spine-words').textContent`), thoughts[6].text, 'full words survive placement');
  await click('[data-thought="p6"] button[aria-label="Topic: Paint the room"]');
  assert.ok(await until(`document.activeElement?.classList.contains('spine-topic-title')`), 'topic link moves focus to branch: ' + await evaluate(`JSON.stringify({active:document.activeElement?.outerHTML.slice(0,200), button:document.querySelector('[data-thought=\"p6\"] button')?.getBoundingClientRect().toJSON(), camera:document.querySelector('.react-flow__viewport').style.transform})`));
  await key('Enter', 'Enter', 13);
  assert.ok(await until(`document.querySelector('.spine-topic[data-thread="room"] .spine-topic-title').getAttribute('aria-expanded')==='true'`));
  assert.equal(await turnPositions(), originalPositions, 'opening a projection keeps the spine still');
  assert.equal(await evaluate(`document.querySelectorAll('.spine-topic[data-thread="room"] .spine-topic-member').length`), 3);
  await click('.spine-topic[data-thread="room"] .spine-topic-member:last-child');
  assert.ok(await until(`!!document.activeElement?.closest('[data-thought="p6"]')`), 'member link returns focus to chronological turn');
  const screenshot = async (name) => {
    if (!process.env.SHOTS) return;
    mkdirSync(process.env.SHOTS, { recursive: true });
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(shot.data, 'base64'));
  };
  await screenshot('projection-desktop');
  // The setting persists, and keeps the chronological turn ids after reconnect/reload.
  await page('Page.navigate', { url });
  assert.ok(await until(`document.querySelectorAll('.spine-ready .spine-conversation-turn').length===6`, 10000));
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  const visible = () => evaluate(`(()=>{const r=document.querySelector('[data-thought="p6"] .spine-turn-topics').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`);
  assert.ok(await visible(), 'phone turn links fit');
  // Reload restores the fixture's unplaced turn; use the preceding placed turn to reach its branch on phone.
  await evaluate(`document.querySelector('[data-thought="p5a"] button[aria-label="Topic: Paint the room"]').focus()`);
  await key('Enter', 'Enter', 13);
  assert.ok(await until(`document.activeElement?.classList.contains('spine-topic-title')`));
  await key('Enter', 'Enter', 13);
  assert.ok(await until(`document.querySelectorAll('.spine-topic[data-thread="room"] .spine-topic-member').length===2`));
  await screenshot('projection-phone-topic');
  await click('.spine-topic[data-thread="room"] .spine-topic-member:last-child');
  assert.ok(await until(`!!document.activeElement?.closest('[data-thought="p5a"]')`));
  await screenshot('projection-phone-turn');
  // Half the desktop's CSS viewport at double pixel density represents its 200% browser zoom.
  await page('Emulation.setDeviceMetricsOverride', { width: 720, height: 450, deviceScaleFactor: 2, mobile: false });
  await sleep(800);
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('[aria-label=\"Type a thought\"]').getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`), 'composer stays reachable at 200%');
  await screenshot('projection-enlarged-200');
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await catalog();
  await click(toggle);
  await key('Escape', 'Escape', 27);
  assert.ok(await until(`!!document.querySelector('.spine-ready .spine-point') && !document.querySelector('.spine-conversation-turn')`));
  assert.equal(await geometry(), legacy, 'off state restores the exact original nodes, text and positions');
  assert.ok(!core.heard.some(m => m.type === 'stay_here'), 'feature never asks core to bypass automatic placement');
  assert.deepEqual(await evaluate('window.errors'), []);
  console.log(`PASS projection page: default off, Features toggle, live classification, two-way keyboard links, reload, phone, unchanged off state; port ${core.port}`);
} catch (error) { if (browser && process.env.SHOTS) { mkdirSync(process.env.SHOTS,{recursive:true}); const shot=await browser.page('Page.captureScreenshot',{format:'png'}); writeFileSync(`${process.env.SHOTS}/failure.png`,Buffer.from(shot.data,'base64')); } throw error; } finally { await browser?.close(); core.close(); }
