import type { Annotation } from './contracts';
import type { SketchLabelsController, SketchLabelsState } from './controller';
import { annotationView } from './AnnotationView';

export function AnnotationList({ state, controller, edit, run }: {
  state: SketchLabelsState; controller: SketchLabelsController; edit: (annotation: Annotation) => void;
  run: (operation: () => void) => void;
}) {
  return <section aria-label="Saved annotations"><h3>Saved labels · {state.annotations.length}</h3>
    {!state.annotations.length && <p>No labels yet. Original marks remain untouched.</p>}
    <ol className="sketch-labels-list">{state.annotations.map(annotation => {
      const view = annotationView(annotation, state.session);
      return <li key={view.id} data-annotation-id={view.id}>
        <strong>{view.label}</strong><p>{view.targetText}</p>
        <dl><dt>Stroke time</dt><dd>{view.strokeTimeText}</dd><dt>Supplied reference</dt><dd>{view.referenceText}</dd><dt>Reference time</dt><dd>{view.referenceTimeText}</dd></dl>
        <p>{view.status}</p><div className="sketch-labels-row">
          <button type="button" onClick={() => edit(annotation)}>Revise {view.label}</button>
          <button type="button" onClick={() => run(() => controller.remove(view.id))}>Remove {view.label}</button>
        </div>
      </li>;
    })}</ol>
  </section>;
}
