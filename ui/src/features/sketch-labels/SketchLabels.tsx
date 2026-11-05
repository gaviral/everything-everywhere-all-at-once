import { useState, useSyncExternalStore } from 'react';
import type { SketchLabelsController } from './controller';
import { SelectionTools } from './SelectionTools';
import type { SelectionMode } from './SelectionTools';
import { SketchSurface } from './SketchSurface';
import { AnnotationEditor } from './AnnotationEditor';
import { AnnotationList } from './AnnotationList';
import './sketch-labels.css';

/** The host owns the controller lifetime and calls dispose when its session closes. */
export function SketchLabels({ controller }: { controller: SketchLabelsController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.read, controller.read);
  const [mode, setMode] = useState<SelectionMode>('lasso');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const run = (operation: () => void) => {
    try { operation(); setError(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The change could not be saved.'); }
  };
  const editing = state.annotations.find(annotation => annotation.id === editingId) ?? null;
  return <section className="sketch-labels" aria-label="Sketch labels">
    <header><div><h2>Sketch labels</h2><p>Choose the marks. Keep the moment.</p></div>
      <label className="sketch-labels-switch"><input type="checkbox" checked={state.enabled} onChange={event => { setEditingId(null); run(() => controller.setEnabled(event.target.checked)); }} />Enable sketch labels</label>
    </header>
    <p role="status">{state.message}</p>{error && <p role="alert">{error}</p>}
    {state.enabled && state.ready && <>
      <SelectionTools controller={controller} state={state} mode={mode} setMode={next => { setMode(next); setEditingId(null); }} run={run} />
      <SketchSurface key={`${state.session.id}-${mode}`} state={state} controller={controller} mode={mode} run={run} />
      <div className="sketch-labels-row"><button type="button" disabled={!state.canUndo} onClick={() => { setEditingId(null); run(() => controller.undo()); }}>Undo annotation change</button><span>{state.session.strokes.length} original marks · preserved</span></div>
      <div className="sketch-labels-columns">
        <AnnotationEditor key={`${state.session.id}-${editing?.id ?? 'new'}`} controller={controller} editing={editing} selectionReady={!!state.selection} finish={() => setEditingId(null)} run={run} />
        <AnnotationList state={state} controller={controller} edit={annotation => setEditingId(annotation.id)} run={run} />
      </div>
    </>}
  </section>;
}
