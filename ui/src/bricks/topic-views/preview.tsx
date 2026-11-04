import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BrickProps } from '../contract';
import TopicViews from './index';
import { example } from './example';

function Preview() {
  const [fixture, setFixture] = useState('empty');
  const [mounted, mount] = useState(true);
  const [jump, setJump] = useState('');
  const [connected, connect] = useState(true);
  const [revision, revise] = useState(0);
  const thoughts = example.thoughts.filter(thought => fixture !== 'missing' || thought.id !== 'example-2')
    .map(thought => thought.id === 'example-2' && fixture === 'changed' ? { ...thought, text: 'The source has new words.' } : thought);
  const map: BrickProps['map'] = { threads: fixture === 'empty' ? [] : example.threads.map(thread => revision && thread.id === 'example-opening' ? { ...thread, title: 'A warm welcome' } : thread),
    thoughts: fixture === 'empty' ? [] : thoughts, me: 'Reader', visitKey: fixture === 'other' ? 'other-map' : 'first-map', connected,
    questions: [], usage: null, jobs: [], active: null, suggestions: [], reminders: [], apps: [], notes: {}, points: new Map(),
    rooms: new Map(), topics: [], positions: {}, speakers: new Map(), partial: '' };
  // New action wrappers on each render model the host when returning from another view.
  const actions = { openThought: (id: string) => { setJump(id); mount(false); return true; } } as BrickProps['actions'];
  return <>
    <fieldset><legend>Preview controls</legend>
      <select id="fixture" value={fixture} onChange={event => setFixture(event.target.value)}>{['empty', 'live', 'changed', 'missing', 'other'].map(value => <option key={value}>{value}</option>)}</select>
      <button id="mount" onClick={() => mount(!mounted)}>{mounted ? 'Hide' : 'Return'}</button>
      <button id="connection" onClick={() => connect(!connected)}>Reconnect</button>
      <button id="revision" onClick={() => revise(revision + 1)}>Rename topic</button>
      <output id="jump">{jump}</output>
    </fieldset>
    {mounted && <TopicViews map={map} actions={actions} on={() => () => {}} brick={{ id: 'topic-views', name: 'Topic views', does: '', kind: 'view', defaultOn: false, demoSafe: true }} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
