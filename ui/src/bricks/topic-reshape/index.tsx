import { useLayoutEffect, useRef, useState } from 'react';
import type { BrickProps, MapSnapshot } from '../contract';
import { copyMap, draftFor, planReshape, type Draft, type Plan } from './model';
import { DraftFields, OperationPicker, ReshapePreview, TopicGarden } from './parts';
import './topic-reshape.css';

function ReshapeWorkspace({ map, close }: { map: MapSnapshot; close: () => void }) {
  const [copy, setCopy] = useState(() => copyMap(map));
  const [draft, setDraft] = useState(() => draftFor(copy.topics[0].id));
  const [preview, setPreview] = useState<Plan | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [message, setMessage] = useState('Choose a change. Preview shows every affected point before you confirm.');
  const previewButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<'edit' | 'undo' | null>(null);
  useLayoutEffect(() => {
    if (preview) document.getElementById('topic-reshape-preview-title')?.focus();
    else if (returnFocus.current) {
      (returnFocus.current === 'undo' ? undoButton : previewButton).current?.focus();
      returnFocus.current = null;
    }
  }, [preview]);
  const edit = (patch: Partial<Draft>) => { setDraft(value => ({ ...value, ...patch })); setMessage('Changes are still a draft. Preview before confirming.'); };
  const review = () => {
    const result = planReshape(copy, draft);
    if (result.plan) setPreview(result.plan);
    else setMessage(result.error);
  };
  const cancel = () => { returnFocus.current = 'edit'; setPreview(null); setMessage('Preview cancelled. Your copy is unchanged.'); };
  const confirm = () => {
    if (!preview || preview.before !== copy) return;
    setCopy(preview.after);
    setHistory(items => [...items, preview]);
    setDraft(draftFor(preview.after.topics.some(topic => topic.id === draft.source) ? draft.source : preview.after.topics[0].id));
    setMessage(`Confirmed in local copy: ${preview.label}. Undo restores exactly the previous copy.`);
    returnFocus.current = 'undo';
    setPreview(null);
  };
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setCopy(last.before);
    setHistory(items => items.slice(0, -1));
    setDraft(draftFor(last.before.topics[0].id));
    setMessage(`Undone: ${last.label}. Original topics, point order and parents restored.`);
    heading.current?.focus();
  };
  return <section className="topic-reshape" data-guide="topic-reshape" aria-label="Local topic reshape">
    <div className="topic-reshape-top"><span className="topic-reshape-badge">{copy.example ? 'Example content' : 'Snapshot of your map'} · local rehearsal</span>
      <button type="button" onClick={close}>Back to map</button></div>
    <h1 ref={heading} tabIndex={-1}>A clearer shape<br /><em>for your thinking.</em></h1>
    <p className="topic-reshape-intro">Split a topic. Bring two together. Find a better parent.</p>
    <p className="topic-reshape-scope">This working copy lives only while this view is open. Confirm and Undo affect this copy; they do not save to the shared map.</p>
    <div className="topic-reshape-layout">
      <section className="topic-reshape-editor" aria-label="Reshape editor" inert={preview !== null}>
        <p className="topic-reshape-eyebrow">01 / Choose the change</p>
        <label>Topic<select value={draft.source} onChange={event => { setDraft(draftFor(event.target.value)); setMessage('Topic selected. Choose how to reshape it.'); }}>
          {copy.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
        </select></label>
        <OperationPicker kind={draft.kind} choose={kind => edit({ kind, target: '' })} />
        <DraftFields copy={copy} draft={draft} edit={edit} />
        <button ref={previewButton} type="button" className="topic-reshape-primary" onClick={review}>Preview reshape →</button>
      </section>
      <div className="topic-reshape-stage">
        {preview ? <ReshapePreview plan={preview} confirm={confirm} cancel={cancel} /> : <>
          <div className="topic-reshape-copy-title"><h2>Your working copy</h2>
            {history.length > 0 && <button ref={undoButton} type="button" onClick={undo} aria-label={`Undo ${history.at(-1)!.label}`}>↶ Undo last reshape</button>}</div>
          <TopicGarden copy={copy} label="Current working copy" />
          <p className="topic-reshape-footnote">{history.length} confirmed {history.length === 1 ? 'change' : 'changes'} in this copy · Undo steps back one exact reshape at a time.</p>
        </>}
      </div>
    </div>
    <p className="topic-reshape-status" role="status">{message}</p>
  </section>;
}

export default function TopicReshape({ map, actions }: BrickProps) {
  return <ReshapeWorkspace key={`${map.visitKey ?? map.mapIdentity ?? 'visit'}:${map.me}`} map={map} close={actions.closeView} />;
}
