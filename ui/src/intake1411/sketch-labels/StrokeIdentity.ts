import type { SketchSession, Stroke, TimeSpan } from './contracts';

export function orderedSession(input: SketchSession): SketchSession {
  if (!input.id.trim()) throw new Error('A session identity is required.');
  const ids = new Set<string>();
  const strokes = input.strokes.map(stroke => {
    if (!stroke.id.trim() || ids.has(stroke.id)) throw new Error('Stroke identities must be unique.');
    ids.add(stroke.id);
    if (!stroke.points.length) throw new Error('A stroke needs timestamped marks.');
    let previous = -Infinity;
    const points = stroke.points.map(point => {
      if (![point.x, point.y, point.atMs].every(Number.isFinite) || point.atMs < 0 || point.atMs < previous)
        throw new Error('Stroke timestamps must be finite and ordered.');
      previous = point.atMs;
      return Object.freeze({ ...point });
    });
    return Object.freeze({ id: stroke.id, points: Object.freeze(points) });
  });
  // Sorting a copy preserves the adapter's marks and their point order.
  strokes.sort((a, b) => a.points[0].atMs - b.points[0].atMs || a.id.localeCompare(b.id));
  return Object.freeze({ id: input.id, strokes: Object.freeze(strokes) });
}

export function strokeTime(strokes: readonly Stroke[], ids: readonly string[]): TimeSpan {
  const selected = ids.map(id => {
    const stroke = strokes.find(item => item.id === id);
    if (!stroke) throw new Error('A selected stroke is no longer available. Select again.');
    return stroke;
  });
  if (!selected.length) throw new Error('Select at least one stroke.');
  return Object.freeze({
    startMs: Math.min(...selected.map(stroke => stroke.points[0].atMs)),
    endMs: Math.max(...selected.map(stroke => stroke.points[stroke.points.length - 1].atMs)),
  });
}
