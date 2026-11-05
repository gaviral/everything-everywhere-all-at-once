import type { Point, Selection } from './contracts';

export function highlightRegion(id: string, from: Point, to: Point): Selection {
  if (!id.trim() || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) throw new Error('Choose a valid region.');
  const bounds = Object.freeze({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) });
  if (bounds.width < 2 || bounds.height < 2) throw new Error('Drag a region with visible width and height.');
  return Object.freeze({ kind: 'region', region: Object.freeze({ id, bounds }) });
}
