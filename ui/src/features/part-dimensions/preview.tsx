import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CodePart } from '../../code-canvas/types';
import { PartDimensions, PartDimensionsControl, type Presentation, type Contribution } from './index';

// Synthetic canonical snapshot for a scoped preview; never used as a production catalog.
const parts: CodePart[] = [
  { id: 'demo:step-card', name: 'Step card', file: 'demo/step-card.tsx', line: 1, tags: ['view'], version: 3, version_scope: 'file history' },
  { id: 'demo:selection', name: 'Selection', file: 'demo/selection.ts', line: 1, tags: ['function'], version: 2, version_scope: 'file history' },
  { id: 'demo:record', name: 'Step record', file: 'demo/record.ts', line: 1, tags: ['data'], version: 4, version_scope: 'file history' },
  { id: 'demo:label', name: 'Step label', file: 'demo/label.ts', line: 1, tags: ['data'], version: 1, version_scope: 'file history' },
];
const ref = (index: number, children: Contribution[] = []): Contribution => ({ part: { id: parts[index].id, version: parts[index].version }, children });
const presentation: Presentation = { version: 'preview-1', steps: [
  { id: 'choose', title: 'Choose a step', description: 'The viewer selects one moment in the sequence.',
    contributors: { ui: [ref(0, [ref(1)])], functionality: [ref(1)], data: [ref(2, [ref(3)])] } },
  { id: 'trace', title: 'Trace its contributors', description: 'The same canonical identity connects the visible card, its behavior and its record.',
    contributors: { ui: [ref(0, [ref(1)])], functionality: [ref(1, [ref(2)])], data: [ref(2, [ref(1)])] } },
  { id: 'inspect', title: 'Inspect a part', description: 'Part revisions stay attached to source identity as presentation order changes.',
    contributors: { ui: [ref(0)], functionality: [ref(1)], data: [ref(2)] } },
] };

function Preview() {
  const [enabled, setEnabled] = useState(false);
  const [missing, setMissing] = useState(false);
  const [changedRevision, setChangedRevision] = useState(false);
  const [empty, setEmpty] = useState(false);
  const graph = { parts: parts.filter(part => !missing || part.id !== 'demo:selection')
    .map(part => changedRevision && part.id === 'demo:selection' ? { ...part, version: 5 } : part) };
  return <main style={{ maxWidth: 1320, margin: 'auto', padding: 16, fontFamily: 'system-ui' }}>
    <p>Synthetic preview · No live demo binding</p>
    <PartDimensionsControl enabled={enabled} onEnabledChange={setEnabled} />
    <PartDimensions enabled={enabled} graph={graph} presentation={empty ? { ...presentation, steps: [] } : presentation}
      fallback={<section id="original-view"><h1>Original view</h1><p>Part dimensions is off.</p></section>} />
    <fieldset style={{ marginTop: 24 }}><legend>Preview conditions</legend>
      <label className="pd-control"><input id="missing-part" type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)} /> Missing part</label>{' '}
      <label className="pd-control"><input id="changed-revision" type="checkbox" checked={changedRevision} onChange={event => setChangedRevision(event.target.checked)} /> Changed source revision</label>{' '}
      <label className="pd-control"><input id="empty-sequence" type="checkbox" checked={empty} onChange={event => setEmpty(event.target.checked)} /> Empty sequence</label>
    </fieldset>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
