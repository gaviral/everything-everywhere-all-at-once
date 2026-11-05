import type { Point, Selection, Stroke } from './contracts';

function onEdge(point: Point, a: Point, b: Point): boolean {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  return Math.abs(cross) < 0.0001 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
    && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
}

function contains(polygon: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onEdge(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

export function explicitStrokes(strokes: readonly Stroke[], ids: readonly string[]): Selection | null {
  const chosen = new Set(ids);
  if ([...chosen].some(id => !strokes.some(stroke => stroke.id === id))) throw new Error('Choose existing mark IDs.');
  const strokeIds = strokes.filter(stroke => chosen.has(stroke.id)).map(stroke => stroke.id);
  return strokeIds.length ? Object.freeze({ kind: 'strokes', strokeIds: Object.freeze(strokeIds) }) : null;
}

/** Only marks completely enclosed by the explicit lasso are selected. */
export function lassoSelection(strokes: readonly Stroke[], polygon: readonly Point[]): Selection | null {
  if (polygon.length < 3 || polygon.some(point => ![point.x, point.y].every(Number.isFinite))) return null;
  return explicitStrokes(strokes, strokes.filter(stroke => stroke.points.every(point => contains(polygon, point))).map(stroke => stroke.id));
}
