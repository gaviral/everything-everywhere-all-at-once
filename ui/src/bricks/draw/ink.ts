// Ink: what a pen stroke is, and how it looks. Places are fractions of the sheet, so a stroke survives a resize.
export type Point = { x: number; y: number; p: number };
export type Stroke = { id: string; points: Point[]; at: number; end: number };

const INK = "#f6ecdc";
/** A steady hand: each new point moves part of the way from the last, so a shaky tablet line reads as drawn. */
const STEADY = 0.62;
/** A mouse reports no pressure; this is a confident pen's width. */
const PLAIN_PRESSURE = 0.5;

export const pressureOf = (pressure: number, pointerType: string) => pointerType === "pen" && pressure > 0 ? pressure : PLAIN_PRESSURE;

export function steadied(last: Point | undefined, next: Point): Point {
  if (!last) return next;
  return { x: last.x + (next.x - last.x) * STEADY, y: last.y + (next.y - last.y) * STEADY, p: last.p + (next.p - last.p) * 0.5 };
}

const widthAt = (pressure: number, sheetWidth: number) => Math.max(2.5, sheetWidth * 0.0016) * (0.45 + pressure * 1.5);

/** One stretch of a stroke, ending at point `index`: a curve through the midpoints, so joins never show. */
export function paintStretch(context: CanvasRenderingContext2D, stroke: Stroke, index: number, width: number, height: number) {
  const a = stroke.points[Math.max(0, index - 2)], b = stroke.points[Math.max(0, index - 1)], c = stroke.points[index];
  context.strokeStyle = INK;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = widthAt(c.p, width);
  context.beginPath();
  context.moveTo((a.x + b.x) / 2 * width, (a.y + b.y) / 2 * height);
  context.quadraticCurveTo(b.x * width, b.y * height, (b.x + c.x) / 2 * width, (b.y + c.y) / 2 * height);
  context.stroke();
}

export function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length === 1) {
    const dot = stroke.points[0];
    context.fillStyle = INK;
    context.beginPath();
    context.arc(dot.x * width, dot.y * height, widthAt(dot.p, width) / 2, 0, Math.PI * 2);
    context.fill();
  }
  for (let index = 1; index < stroke.points.length; index++) paintStretch(context, stroke, index, width, height);
}

export type Box = { left: number; top: number; right: number; bottom: number };
export function boundsOf(strokes: readonly Stroke[]): Box | null {
  const points = strokes.flatMap(stroke => stroke.points);
  if (!points.length) return null;
  return {
    left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
  };
}
