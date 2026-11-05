import type { Point } from './contract';

/** A single active pointer, in the existing D75 1000 × 600 coordinate space. */
export class PointerStroke {
  private active?: { id: number; points: Point[] };
  begin(id: number, point: Point) { if (this.active) return false; this.active = { id, points: [point] }; return true; }
  move(id: number, point: Point, limit: number) {
    if (this.active?.id === id && this.active.points.length < limit) this.active.points.push(point);
    return this.points;
  }
  end(id: number) { if (this.active?.id !== id) return undefined; const points = this.points; this.cancel(); return points; }
  cancel() { this.active = undefined; }
  get points(): readonly Point[] { return this.active?.points ?? []; }
}
export function surfacePoint(element: SVGSVGElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(1000, (clientX - rect.left) / rect.width * 1000))),
    Math.round(Math.max(0, Math.min(600, (clientY - rect.top) / rect.height * 600)))];
}
