import type { DrawingOperation, StrokeEntry } from './contract';

export type Stroke = Extract<DrawingOperation, { kind: 'stroke' }>;
/** Corrections and undo change visibility; original entries are never removed. */
export function visibleStrokes(entries: readonly StrokeEntry[]): Stroke[] {
  const strokes = new Map<string, Stroke>();
  for (const { operation } of entries) {
    if (operation.kind === 'undo') strokes.delete(operation.strokeId);
    else {
      if (operation.replaces) strokes.delete(operation.replaces);
      strokes.set(operation.id, operation);
    }
  }
  return [...strokes.values()];
}
export const originalStrokes = (entries: readonly StrokeEntry[]) => entries.flatMap(({ operation }) => operation.kind === 'stroke' ? [operation] : []);
