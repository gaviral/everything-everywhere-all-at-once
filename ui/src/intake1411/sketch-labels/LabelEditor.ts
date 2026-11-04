import type { Annotation, AnnotationStore } from './contracts';

export function labelText(text: string): string {
  if (!text.trim()) throw new Error('Enter a label.');
  if (text.trim().length > 240) throw new Error('Use a label of 240 characters or fewer.');
  return text.trim();
}

/** History advances only after a successful atomic save. Originals are never in this store. */
export class LabelEditor {
  private history: (readonly Annotation[])[] = [];
  constructor(private store: AnnotationStore, private sessionId: string, private labels: readonly Annotation[]) {}
  read = () => this.labels;
  canUndo = () => this.history.length > 0;
  replace(next: readonly Annotation[]) {
    this.store.replace(this.sessionId, next);
    this.history.push(this.labels);
    this.labels = next;
  }
  undo() {
    const previous = this.history[this.history.length - 1];
    if (!previous) return;
    this.store.replace(this.sessionId, previous);
    this.history.pop();
    this.labels = previous;
  }
}
