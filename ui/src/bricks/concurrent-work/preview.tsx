import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginStateContext, type BrickProps, type Job, type PluginState, type Thought, type ThoughtSource } from '../contract';
import ConcurrentWork, { styles } from './index';
import manifest from './brick.json';

const memory = new Map<string, unknown>();
const state: PluginState = { scope: 'check', get: <T,>(key: string) => memory.get(key) as T | undefined, set: (key, value) => { memory.set(key, value); } };
const thought = (id: string, text: string, at_ms: number): Thought => ({ id, text, at_ms, speaker: 'Visitor', thread_id: 'opening', placed: true, point: text, unclear: '', complete: true, place_ms: at_ms });
const original = thought('original', 'Keep the original opening while two helpers explore.', 1);
const answer: Job = { id: 'answer', by: 'Helper', status: 'done', demo: false, at_ms: 2, helper_kind: 'thinking', result: 'Lead with the original thought; keep the explorations beside it.', title: 'Opening recommendation' };
const coding: Job = { id: 'code', by: 'Helper', status: 'done', demo: false, at_ms: 3, helper_kind: 'coding', result_id: 'check-proposal', title: 'Return button proposal', result: 'Proposed a return button.' };

function Preview() {
  const [condition, setCondition] = useState('empty');
  const [mounted, mount] = useState(true);
  const [late, arrive] = useState(false);
  const [updated, update] = useState(false);
  const [jump, setJump] = useState('');
  const [draft, setDraft] = useState('Continue my unfinished thought');
  const [calls, count] = useState(0);
  const jobs: Job[] = condition === 'empty' ? [] : [condition === 'partial' ? { ...answer, outcome: 'partial' } : condition === 'failed-outcome' ? { ...answer, outcome: 'failed' } : updated ? { ...answer, result: 'Revised recommendation.', at_ms: 10 } : answer, coding,
    { id: 'queue', by: 'Helper', title: 'Explore the next scene', status: 'queued', demo: false, at_ms: 3 },
    { id: 'failed', by: 'Helper', title: 'Unavailable reference', status: 'failed', result: 'Could not read the reference.', demo: false, at_ms: 4 },
    { id: 'simulated', by: 'Demo helper', title: 'Simulated proposal', status: 'done', result_id: 'must-not-fetch', helper_kind: 'coding', demo: true, at_ms: 5 },
    ...(late ? [{ ...answer, id: 'late', title: 'Late independent result', at_ms: 8 }] : [])];
  const thoughts = condition === 'empty' ? [] : condition === 'missing' ? [] : [condition === 'changed' ? { ...original, text: 'Changed source' } : original,
    ...(late ? [thought('newer', 'A newer thought must not replace the held one.', 6)] : [])];
  const map = { visitKey: condition === 'other-visit' ? 'second' : 'first', mapIdentity: 'check-map', me: 'Visitor', connected: condition !== 'offline', thoughts,
    threads: [{ id: 'opening' }], jobs } as unknown as BrickProps['map'];
  const actions = {
    openThought: (source: ThoughtSource) => { count(n => n + 1); const live = thoughts.find(t => t.id === source.id); if (!live || live.text !== source.text) return false; setJump(source.id); mount(false); return true; },
    closeView: () => mount(false), listen: () => { throw new Error('Microphone must never start'); },
  } as unknown as BrickProps['actions'];
  return <PluginStateContext value={state}><style>{styles}</style>
    {mounted && <ConcurrentWork map={map} actions={actions} on={() => () => {}} brick={{ ...manifest, kind: 'view' }} />}
    {!mounted && <div id="capture"><p>Exact capture: {thoughts.find(t => t.id === jump)?.text}</p></div>}
    <fieldset style={{ padding: 20, margin: 20 }}><legend>Isolated synthetic host</legend>
      <label>Capture draft <textarea id="capture-draft" value={draft} onChange={e => setDraft(e.target.value)} /></label>
      <select id="fixture" value={condition} onChange={event => setCondition(event.target.value)}>{['empty', 'live', 'changed', 'missing', 'offline', 'partial', 'failed-outcome', 'other-visit'].map(name => <option key={name}>{name}</option>)}</select>
      <button id="mount" onClick={() => mount(value => !value)}>Hide / return</button>
      <button id="late" onClick={() => arrive(true)}>Late arrivals</button>
      <button id="update" onClick={() => update(true)}>Revise result</button>
      <output id="jump">{jump}</output><output id="calls">{calls}</output>
    </fieldset>
  </PluginStateContext>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
