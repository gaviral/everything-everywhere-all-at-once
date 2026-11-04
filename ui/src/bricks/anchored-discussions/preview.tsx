import { useRef, useState, type ContextType } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscussionContext, PluginStateContext, type BrickProps, type PluginState, type Thought, type Thread } from '../contract';
import AnchoredDiscussions from './index';
import { example } from './model';

type Host = NonNullable<ContextType<typeof DiscussionContext>>;
type Record = NonNullable<Host['world']['discussions']>[number];
const memory = new Map<string, unknown>();
const state: PluginState = { scope: 'discussion-check', get: <T,>(key: string) => memory.get(key) as T | undefined, set: (key, value) => { memory.set(key, value); } };
const thought = (id: string, text: string, thread: string, at: number): Thought => ({ id, speaker: 'Alex', text, point: text, thread_id: thread, placed: true, unclear: '', complete: true, at_ms: at, place_ms: 0 });
const thread = (id: string): Thread => ({ id, title: 'Opening moment', parent_id: null, status: 'open', last_point: '', touched_ms: 1, tags: [], picture: null, dropped_by: '' });
const original = '🌿 Start with the map, then start with the map again.';
const quote = 'start with the map';
const start = [...original.slice(0, original.indexOf(quote))].length;
const anchor = { thought_id: 'source', quote, context: { source_text: original, source_speaker: 'Alex', start, end: start + [...quote].length } };

function Preview() {
  const [condition, setCondition] = useState('empty');
  const [records, update] = useState<Record[]>([]);
  const [mounted, mount] = useState(true);
  const [enabled, enable] = useState(true);
  const [connected, connect] = useState(true);
  const [refuse, reject] = useState(false);
  const [calls, count] = useState(0);
  const [jump, jumpTo] = useState('');
  const [extra, addReply] = useState(false);
  const held = useRef<(() => void) | null>(null);
  const [hold, setHold] = useState(false);
  const thoughts = [thought('source', condition === 'changed' ? 'The opening has changed.' : original, 'main', 1), ...example.replies.map(reply => thought(reply.id, reply.text, 'discussion', reply.at_ms))];
  if (extra) thoughts.push(thought('new-reply', 'One more question after resolution.', 'discussion', 4));
  const threads = condition === 'empty' ? [] : [thread('main'), { ...thread('discussion'), parent_id: 'main', anchor }];
  const liveThoughts = condition === 'missing' ? thoughts.filter(item => item.id !== 'source') : thoughts;
  const world = { threads, thoughts: liveThoughts, anchors: { discussion: anchor }, discussions: records };
  const map = { ...world, visitKey: condition === 'other-visit' ? 'other' : 'first', me: 'Alex', connected } as unknown as BrickProps['map'];
  const actions = {
    openThought: (id: string) => { jumpTo(id); mount(false); return true; },
    openCatalog: (id: string) => jumpTo(`features:${id}`),
  } as BrickProps['actions'];
  const save: Host['set'] = async (id, status, revision) => {
    count(value => value + 1);
    if (hold) await new Promise<void>(resolve => { held.current = resolve; });
    const current = records.find(item => item.thread_id === id);
    if (refuse || !connected || !enabled || (current?.revision ?? 0) !== revision) return { request_id: 'check', ok: false, discussion: current ?? null, message: 'Discussion changed. Review its current state before choosing again.' };
    const discussion: Record = { thread_id: id, status, actor: 'Alex', revision: revision + 1, observed_revision: revision, request_id: `check-${revision}`, at_ms: 10, reply_count: liveThoughts.filter(item => item.thread_id === id).length };
    update([discussion]);
    return { request_id: discussion.request_id, ok: true, discussion, message: 'Discussion saved.' };
  };
  return <PluginStateContext value={state}><DiscussionContext value={{ world, enabled, set: save, showResolved: false, setShowResolved: () => {} }}>
    {mounted && <AnchoredDiscussions map={map} actions={actions} on={() => () => {}} brick={{ id: 'anchored-discussions', name: 'Discussions', does: '', kind: 'view', defaultOn: false, demoSafe: true }} />}
    <fieldset style={{ margin: 24 }}><legend>Isolated check controls</legend>
      <select id="fixture" value={condition} onChange={event => setCondition(event.target.value)}>{['empty', 'live', 'changed', 'missing', 'other-visit'].map(value => <option key={value}>{value}</option>)}</select>
      <button id="mount" onClick={() => mount(!mounted)}>{mounted ? 'Hide' : 'Return'}</button>
      <button id="enabled" onClick={() => enable(!enabled)}>Toggle status feature</button>
      <button id="connected" onClick={() => connect(!connected)}>Toggle connection</button>
      <button id="refuse" onClick={() => reject(!refuse)}>Toggle refusal</button>
      <button id="reply" onClick={() => addReply(true)}>Add late reply</button>
      <button id="hold" onClick={() => setHold(!hold)}>Hold acknowledgement</button>
      <button id="release" onClick={() => { held.current?.(); held.current = null; }}>Release acknowledgement</button>
      <output id="calls">{calls}</output><output id="jump">{jump}</output>
    </fieldset>
  </DiscussionContext></PluginStateContext>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
