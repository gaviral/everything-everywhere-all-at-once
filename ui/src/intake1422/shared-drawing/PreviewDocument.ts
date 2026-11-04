import { MAX_OPERATIONS, MAX_POINTS, validOperation, type DrawingOperation, type StrokeEntry } from './contract';
import { visibleStrokes } from './StrokeProjection';

/** Synthetic canonical journal. No production transport or schema is registered. */
export class PreviewDocument {
  private journal: StrokeEntry[] = [];
  constructor(readonly sessionId: string, readonly exchangeId: string) {}
  read(authorId: string): readonly StrokeEntry[] {
    return this.journal.filter(entry => entry.acknowledged || entry.operation.authorId === authorId);
  }
  append(operation: DrawingOperation) {
    if (!validOperation(operation) || operation.sessionId !== this.sessionId || operation.exchangeId !== this.exchangeId) throw new Error('Invalid sketch operation.');
    const existing = this.journal.find(entry => entry.operation.id === operation.id);
    if (existing) {
      if (JSON.stringify(existing.operation) !== JSON.stringify(operation)) throw new Error('Stroke ID already belongs to another operation.');
      return;
    }
    const points = this.journal.reduce((n, entry) => n + (entry.operation.kind === 'stroke' ? entry.operation.points.length : 0), 0);
    if (this.journal.length >= MAX_OPERATIONS || points + (operation.kind === 'stroke' ? operation.points.length : 0) > MAX_POINTS) throw new Error('Sketch is full.');
    const reference = operation.kind === 'undo' ? operation.strokeId : operation.replaces;
    if (reference && !visibleStrokes(this.journal).some(stroke => stroke.id === reference)) throw new Error('Choose a visible stroke.');
    const copy = operation.kind === 'stroke' ? { ...operation, points: Object.freeze(operation.points.map(point => Object.freeze([point[0], point[1]] as const))) } : { ...operation };
    this.journal = [...this.journal, Object.freeze({ operation: Object.freeze(copy), acknowledged: false })];
  }
  acknowledge(canDeliver: (authorId: string) => boolean) {
    // A later correction must never overtake the original it refers to.
    let blocked = false;
    this.journal = this.journal.map(entry => {
      if (entry.acknowledged) return entry;
      blocked ||= !canDeliver(entry.operation.authorId);
      return blocked ? entry : Object.freeze({ ...entry, acknowledged: true });
    });
  }
}
