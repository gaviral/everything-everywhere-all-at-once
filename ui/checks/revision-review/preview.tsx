import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginStateContext, type BrickProps, type PluginState, type Thought } from '../../src/bricks/contract';
import RevisionReview, { styles } from '../../src/bricks/revision-review';
import { applyCommand, createArtifact, current, type Command } from '../../src/bricks/revision-review/model';

const memory = new Map<string, unknown>();
const store: PluginState = { scope: 'isolated-check', get: <T,>(key: string) => memory.get(key) as T | undefined, set: (key, value) => { memory.set(key, value); } };
const source: Thought = { id: 'source', text: '🌿 Begin here. Begin here. Then return to the map.', point: 'Opening guide', speaker: 'Editor', placed: true, thread_id: 'main', unclear: '', complete: true, at_ms: 1, place_ms: 0 };

// Guard controls use the same transition part; no network, model or microphone is started.
function checkGuards() {
  let artifact = createArtifact('Guard specimen', 'Exact words');
  const apply = (command: Command, observed = current(artifact).number) => { artifact = applyCommand(artifact, observed, command); };
  const decision = { kind: 'approved' as const, actor: 'Human', at: 1, reason: '' };
  const receipt = { effect: 'Guide used', evidence: 'Observed result', actor: 'Human', at: 2 };
  apply({ kind: 'decide', decision, confirmed: true });
  if (current(artifact).decision) throw new Error('Draft accepted approval');
  apply({ kind: 'complete', receipt, confirmed: true });
  if (current(artifact).receipt) throw new Error('Draft accepted completion');
  apply({ kind: 'ready' });
  apply({ kind: 'decide', decision, confirmed: false });
  if (current(artifact).decision) throw new Error('Acknowledgement accepted approval');
  apply({ kind: 'decide', decision, confirmed: true });
  apply({ kind: 'complete', receipt: { ...receipt, evidence: ' ' }, confirmed: true });
  if (current(artifact).receipt) throw new Error('Empty evidence accepted');
  apply({ kind: 'complete', receipt, confirmed: true });
  apply({ kind: 'revise', title: 'Changed title', body: 'Exact words' });
  apply({ kind: 'decide', decision, confirmed: true }, 1);
  apply({ kind: 'complete', receipt, confirmed: true }, 1);
  apply({ kind: 'comment', passage: { start: 1, end: 6, quote: 'Exact' }, text: 'Wrong offset', actor: 'Human' });
  if (current(artifact).decision || current(artifact).receipt || artifact.comments.length || !artifact.revisions[0].receipt) throw new Error('Revision isolation failed');
  return 'Guards passed';
}

function Preview() {
  const [mounted, mount] = useState(true);
  const [visit, changeVisit] = useState('first');
  const [ai, setAi] = useState(false);
  const [jump, jumpTo] = useState('');
  const [download, record] = useState('');
  const [refuse, reject] = useState(false);
  const [guards, showGuards] = useState('');
  const map = { thoughts: [source], visitKey: visit, me: 'Reviewer', speakers: new Map([['Reviewer', { ai }]]) } as unknown as BrickProps['map'];
  const actions = {
    openThought: (id: string) => { jumpTo(id); mount(false); return true; },
    saveTextFile: (_name: string, text: string) => { if (refuse) return false; record(text); return true; },
  } as unknown as BrickProps['actions'];
  return <PluginStateContext value={store}><style>{styles}</style>
    {mounted && <RevisionReview map={map} actions={actions} on={() => () => {}} brick={{ id: 'revision-review', name: 'Revision review', does: '', kind: 'view', defaultOn: false, demoSafe: true }} />}
    <fieldset style={{ margin: 24 }}><legend>Isolated check controls</legend>
      <button id="mount" onClick={() => mount(!mounted)}>{mounted ? 'Hide' : 'Return'}</button>
      <button id="visit" onClick={() => changeVisit(visit === 'first' ? 'other' : 'first')}>Change visit</button>
      <button id="ai" onClick={() => setAi(!ai)}>Toggle AI participant</button>
      <button id="refuse" onClick={() => reject(!refuse)}>Toggle export refusal</button>
      <button id="guards" onClick={() => showGuards(checkGuards())}>Check transition guards</button>
      <output id="guard-result">{guards}</output><output id="jump">{jump}</output><output id="download" hidden>{download}</output>
    </fieldset>
  </PluginStateContext>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
