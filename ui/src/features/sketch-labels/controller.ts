import type { Annotation, Point, Selection, SketchLabelsAdapters, SketchSession, SuppliedReference } from './contracts';
import { orderedSession } from './StrokeIdentity';
import { explicitStrokes, lassoSelection } from './LassoSelection';
import { highlightRegion } from './HighlightRegion';
import { referenceAnchor, suppliedReference } from './ReferenceAnchor';
import { LabelEditor, labelText } from './LabelEditor';

export type SketchLabelsState = Readonly<{
  enabled: boolean;
  ready: boolean;
  session: SketchSession;
  selection: Selection | null;
  annotations: readonly Annotation[];
  canUndo: boolean;
  message: string;
}>;

function freezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(copy);
  return copy;
}

function savedLabels(sessionId: string, values: readonly Annotation[]): readonly Annotation[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id.trim() || ids.has(value.id) || value.sessionId !== sessionId) throw new Error('Saved annotation identities do not match this session.');
    ids.add(value.id);
    labelText(value.label);
    suppliedReference(value.anchor.reference);
    const target = value.anchor.target;
    if (target.kind === 'strokes') {
      if (!target.strokeIds.length || new Set(target.strokeIds).size !== target.strokeIds.length)
        throw new Error('Saved mark selection is invalid.');
    } else if (target.kind === 'region') {
      const { x, y, width, height } = target.region.bounds;
      highlightRegion(target.region.id, { x, y }, { x: x + width, y: y + height });
    } else throw new Error('Saved target is invalid.');
  }
  return freezeCopy(values);
}

/** Composes the six parts. Construction is inert; only enabling starts adapter work. */
export class SketchLabelsController {
  private state: SketchLabelsState = Object.freeze({ enabled: false, ready: false, session: { id: '', strokes: [] }, selection: null, annotations: [], canUndo: false, message: 'Sketch labels are off.' });
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  private editor: LabelEditor | null = null;
  private editorSession = '';
  constructor(private adapters: SketchLabelsAdapters) {}
  read = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SketchLabelsState>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    this.listeners.forEach(listener => listener());
  }
  private requireEnabled() {
    if (!this.state.enabled || !this.state.ready) throw new Error('Enable sketch labels with an available session first.');
  }
  private refresh = () => {
    if (!this.state.enabled) return;
    try {
      const session = orderedSession(this.adapters.strokes.read());
      const saved = savedLabels(session.id, this.adapters.annotations.read(session.id));
      if (session.id !== this.editorSession || JSON.stringify(saved) !== JSON.stringify(this.editor?.read())) {
        this.editor = new LabelEditor({
          read: this.adapters.annotations.read.bind(this.adapters.annotations),
          replace: (id, labels) => this.adapters.annotations.replace(id, freezeCopy(labels)),
        }, session.id, saved);
        this.editorSession = session.id;
      }
      this.publish({ session, ready: true, selection: null, annotations: this.editor!.read(), canUndo: this.editor!.canUndo(), message: 'Select marks with a lasso or choose a highlight region.' });
    } catch (error) {
      this.publish({ ready: false, selection: null, message: `Session unavailable: ${error instanceof Error ? error.message : 'adapter error'}` });
    }
  };
  setEnabled(enabled: boolean) {
    if (enabled === this.state.enabled) return;
    if (!enabled) {
      this.publish({ enabled: false, ready: false, selection: null, message: 'Sketch labels are off. Drawing and saved labels are retained.' });
      this.stop?.();
      this.stop = null;
      return;
    }
    this.publish({ enabled: true });
    this.refresh();
    try { this.stop = this.adapters.strokes.subscribe(this.refresh); }
    catch { this.publish({ ready: false, message: 'Session subscription unavailable. Switch off and retry.' }); }
  }
  dispose() { this.setEnabled(false); }
  private select(selection: Selection | null) {
    this.publish({ selection, message: selection ? 'Target explicitly selected. Add a label and supplied reference.' : 'Unresolved target. Select marks or a region explicitly.' });
  }
  selectIds(ids: readonly string[]) { this.requireEnabled(); this.select(explicitStrokes(this.state.session.strokes, ids)); }
  lasso(points: readonly Point[]) { this.requireEnabled(); this.select(lassoSelection(this.state.session.strokes, points)); }
  highlight(from: Point, to: Point) { this.requireEnabled(); this.select(highlightRegion(this.adapters.newId(), from, to)); }
  clearSelection() { this.requireEnabled(); this.select(null); }
  private record(next: readonly Annotation[], message: string) {
    this.editor!.replace(Object.freeze([...next]));
    this.publish({ annotations: this.editor!.read(), canUndo: this.editor!.canUndo(), message });
  }
  add(label: string, reference: SuppliedReference) {
    this.requireEnabled();
    const anchor = referenceAnchor(this.state.session, this.state.selection, reference);
    const id = this.adapters.newId();
    if (!id.trim() || this.state.annotations.some(annotation => annotation.id === id)) throw new Error('Annotation identity collision. Retry with a unique identity.');
    const annotation = Object.freeze({ id, sessionId: this.state.session.id, label: labelText(label), anchor });
    this.record([...this.state.annotations, annotation], 'Label saved. Original marks are intact.');
    return annotation;
  }
  private existing(id: string): Annotation {
    this.requireEnabled();
    const annotation = this.state.annotations.find(item => item.id === id);
    if (!annotation) throw new Error('Choose an existing annotation.');
    return annotation;
  }
  revise(id: string, label: string, reference?: SuppliedReference) {
    const current = this.existing(id);
    const text = labelText(label);
    const supplied = reference ? suppliedReference(reference) : current.anchor.reference;
    const anchor = Object.freeze({ ...current.anchor, reference: supplied, uncertainty: supplied.utteranceTime ? 'separate-times' as const : 'reference-time-missing' as const });
    this.record(this.state.annotations.map(item => item.id === id ? Object.freeze({ ...item, label: text, anchor }) : item), 'Label revised. Undo restores its previous wording and reference.');
  }
  remove(id: string) {
    this.existing(id);
    this.record(this.state.annotations.filter(item => item.id !== id), 'Label removed. Undo restores it.');
  }
  undo() {
    this.requireEnabled();
    this.editor!.undo();
    this.publish({ annotations: this.editor!.read(), canUndo: this.editor!.canUndo(), message: 'Annotation change undone. Original marks are intact.' });
  }
}
