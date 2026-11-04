// Lasso: draw a loop around strokes to pick them. A stroke counts when most of it lies inside the loop.
import type { Point, Stroke } from "./ink";

export function inside(point: Pick<Point, "x" | "y">, loop: readonly Pick<Point, "x" | "y">[]) {
  let crossings = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if (a.y > point.y !== b.y > point.y && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) crossings = !crossings;
  }
  return crossings;
}

export function pickedBy(loop: readonly Point[], strokes: readonly Stroke[]) {
  if (loop.length < 3) return [];
  return strokes.filter(stroke => stroke.points.filter(point => inside(point, loop)).length > stroke.points.length / 2).map(stroke => stroke.id);
}
