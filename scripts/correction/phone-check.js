import React from 'react';
import { createRoot } from 'react-dom/client';
import PhoneCorrection from '../../ui/src/bricks/phone-correction/index.tsx';
import { correctionChannel } from '../../ui/src/bricks/phone-correction/protocol.ts';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (condition) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Condition never arrived: ' + condition);
};
class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  send(text) { this.sent.push(JSON.parse(text)); }
  acknowledge(request, extra = {}) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'correction_result', request_id: request.request_id, thought_id: request.thought_id, ok: true, message: request.undo_of ? 'Restored to Garden' : 'Moved to Pottery class', ...extra }) }));
  }
}
const socket = new Socket();
correctionChannel.bind(socket);
const topic = (id, title) => ({ id, title });
const thought = (id, text, thread_id) => ({ id, text, point: text, thread_id, placed: true });
let map = { mapIdentity: 'correction-fixture', me: 'you', connected: true, threads: [topic('garden', 'Garden'), topic('pottery', 'Pottery class')], thoughts: [thought('tomato', 'Plant tomatoes', 'garden'), thought('wheel', 'Learn to throw on the pottery wheel', 'garden')] };
const root = createRoot(document.getElementById('app'));
const render = () => root.render(React.createElement(PhoneCorrection, { map }));
const text = () => document.getElementById('app').textContent;
const click = label => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(label));
  check(button && !button.disabled, 'Missing usable button: ' + label);
  button.click();
};
const requests = () => socket.sent.filter(m => m.type === 'correction');
try {
  render();
  await until(() => document.querySelector('.correction-launch'));
  click('Correct a landing');
  await until(() => document.querySelector('select'));
  check(text().includes('Learn to throw on the pottery wheel'), 'Actual source words shown');
  check(text().includes('LANDED IN Garden'), 'Wrong topic shown');
  await until(() => socket.sent.some(m => m.type === 'corrections' && m.on));
  check(innerWidth <= 430, 'Phone viewport is at most 430 px');
  check(document.documentElement.scrollWidth <= innerWidth, 'No horizontal overflow at phone width');
  check([...document.querySelectorAll('select')].every(s => parseFloat(getComputedStyle(s).fontSize) >= 16), 'Phone fields avoid input zoom');
  click('Move this thought');
  await until(() => requests().length === 1);
  const move = requests()[0];
  check(move.thought_id === 'wheel' && move.from === 'garden' && move.to === 'pottery', 'Exact selected move');
  socket.acknowledge(move, { request_id: 'unrelated' });
  socket.acknowledge(move, { thought_id: 'tomato' });
  await new Promise(resolve => setTimeout(resolve, 30));
  check(text().includes('Waiting for confirmation'), 'Unrelated receipts cannot claim success');
  check(!text().includes('Undo that move'), 'No Undo before confirmation');
  // The server may commit before its acknowledgement reaches a disconnected phone.
  map = { ...map, connected: false, thoughts: map.thoughts.map(t => t.id === 'wheel' ? { ...t, thread_id: 'pottery' } : t) };
  socket.readyState = 3; socket.dispatchEvent(new Event('close')); render();
  await until(() => text().includes('Retry same request'));
  const reconnected = new Socket();
  correctionChannel.bind(reconnected);
  reconnected.dispatchEvent(new Event('open'));
  map = { ...map, connected: true }; render();
  await until(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Retry same request' && !b.disabled));
  click('Retry same request');
  await until(() => reconnected.sent.some(m => m.type === 'correction'));
  const retry = reconnected.sent.find(m => m.type === 'correction');
  check(JSON.stringify(retry) === JSON.stringify(move), 'Reconnect retry keeps exact request identity and payload');
  reconnected.acknowledge(retry);
  await until(() => text().includes('Undo that move'));
  check(text().includes('Moved to Pottery class'), 'Correlated acknowledgement shown');
  const picker = document.querySelector('select');
  picker.value = 'tomato'; picker.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => document.querySelector('blockquote p').textContent === 'Plant tomatoes');
  check(document.querySelector('.correction-receipt').textContent.includes(move.observed_text), 'Undo still names the corrected thought after selecting another');
  click('Undo that move');
  await until(() => reconnected.sent.filter(m => m.type === 'correction').length === 2);
  const undo = reconnected.sent.filter(m => m.type === 'correction')[1];
  check(undo.undo_of === move.request_id && undo.thought_id === move.thought_id && undo.from === 'pottery' && undo.to === 'garden', 'Undo targets the exact move');
  map = { ...map, thoughts: map.thoughts.map(t => t.id === 'wheel' ? { ...t, thread_id: 'garden' } : t) }; render();
  reconnected.acknowledge(undo);
  await until(() => text().includes('Restored to Garden'));
  check(!text().includes('Undo that move'), 'Undo clears only after acknowledgement');
  map = { ...map, thoughts: [] }; render();
  await until(() => text().includes('EXAMPLE'));
  check(text().includes('NO LIVE THOUGHTS YET'), 'Empty map has a labelled example');
  root.unmount();
  check(reconnected.sent.some(m => m.type === 'corrections' && !m.on), 'Switch off revokes opt-in');
  document.getElementById('result').textContent = 'PASS: phone correction, correlated receipt, reconnect retry, exact Undo, example, mobile layout';
} catch (error) {
  document.getElementById('result').textContent = 'FAIL: ' + error.stack;
}

parent.postMessage(document.getElementById('result').textContent, location.origin);
