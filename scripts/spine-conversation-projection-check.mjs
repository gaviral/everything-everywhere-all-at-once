// Conversation first, topic membership second: pure layout invariants and the actual Features comparison in Chrome.
import assert from 'node:assert/strict';
import { uiServer } from './ui-server.mjs';

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

// The session lenses supersede the single-column projection UI. Keep the projection's
// pure invariants above; exercise the shared cards and Features comparison in its successor.
await import('./sessions-check.mjs');
