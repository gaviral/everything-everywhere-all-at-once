import { useEffect, useRef, useState } from 'react';
import type { Annotation, SuppliedReference } from './contracts';
import type { SketchLabelsController } from './controller';

function referenceFromFields(id: string, text: string, start: string, end: string): SuppliedReference {
  if ((start === '') !== (end === '')) throw new Error('Supply both reference times, or leave both blank.');
  return { id, text, source: 'typed', utteranceTime: start === '' ? null : { startMs: Number(start), endMs: Number(end) } };
}

export function AnnotationEditor({ controller, editing, selectionReady, finish, run }: {
  controller: SketchLabelsController; editing: Annotation | null; selectionReady: boolean;
  finish: () => void; run: (operation: () => void) => void;
}) {
  const [label, setLabel] = useState(editing?.label ?? '');
  const [reference, setReference] = useState(editing?.anchor.reference.text ?? '');
  const [start, setStart] = useState(editing?.anchor.reference.utteranceTime?.startMs.toString() ?? '');
  const [end, setEnd] = useState(editing?.anchor.reference.utteranceTime?.endMs.toString() ?? '');
  const labelInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) labelInput.current?.focus(); }, [editing?.id]);
  return <form className="sketch-labels-editor" aria-label={editing ? 'Revise annotation' : 'Add annotation'} onSubmit={event => {
    event.preventDefault();
    run(() => {
      const supplied = referenceFromFields(editing?.anchor.reference.id ?? `typed-${crypto.randomUUID()}`, reference, start, end);
      if (editing) controller.revise(editing.id, label, supplied);
      else controller.add(label, supplied);
      finish();
      if (!editing) { setLabel(''); setReference(''); setStart(''); setEnd(''); }
    });
  }}>
    <h3>{editing ? 'Revise annotation' : 'Explain the selection'}</h3>
    <label>Label<input ref={labelInput} name="label" required maxLength={240} value={label} onChange={event => setLabel(event.target.value)} /></label>
    <label>Supplied reference<input name="reference" required value={reference} onChange={event => setReference(event.target.value)} placeholder="Type a reference to the selected content" /></label>
    <div className="sketch-labels-time-fields">
      <label>Reference start (ms)<input name="start" type="number" min="0" step="any" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>Reference end (ms)<input name="end" type="number" min="0" step="any" value={end} onChange={event => setEnd(event.target.value)} /></label>
    </div>
    <p>Use supplied session times. Leave both blank if unknown. Stroke time stays separate; the temporal interpretation is unconfirmed.</p>
    {!editing && !selectionReady && <p>Select a target before saving. Words alone do not choose marks.</p>}
    <div className="sketch-labels-row"><button type="submit" disabled={!editing && !selectionReady}>{editing ? 'Save revision' : 'Attach label'}</button>
      {editing && <button type="button" onClick={finish}>Cancel revision</button>}</div>
  </form>;
}
