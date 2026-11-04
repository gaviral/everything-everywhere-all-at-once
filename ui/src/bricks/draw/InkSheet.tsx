// The sheet: a canvas the pen draws on. Painting happens here, stroke by stroke, so drawing never waits for React.
import { useEffect, useLayoutEffect, useRef } from "react";
import { paintStretch, paintStroke, pressureOf, steadied, type Point, type Stroke } from "./ink";

export type Tool = "pen" | "lasso";
type Props = { strokes: readonly Stroke[]; tool: Tool; onStroke: (stroke: Stroke) => void; onLoop: (loop: Point[]) => void };

export function InkSheet({ strokes, tool, onStroke, onLoop }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);

  const repaint = () => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d")!;
    context.clearRect(0, 0, element.width, element.height);
    for (const stroke of strokes) paintStroke(context, stroke, element.width, element.height);
  };
  const fit = () => {
    const element = canvas.current;
    if (!element) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    element.width = element.clientWidth * scale;
    element.height = element.clientHeight * scale;
    repaint();
  };
  useLayoutEffect(fit, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const watcher = new ResizeObserver(fit);
    watcher.observe(element);
    return () => watcher.disconnect();
  });
  useLayoutEffect(repaint, [strokes]);

  const here = (event: PointerEvent | React.PointerEvent): Point => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, p: pressureOf(event.pressure, event.pointerType) };
  };
  const extend = (point: Point) => {
    const stroke = live.current, element = canvas.current;
    if (!stroke || !element) return;
    stroke.points.push(steadied(stroke.points[stroke.points.length - 1], point));
    if (tool === "pen") paintStretch(element.getContext("2d")!, stroke, stroke.points.length - 1, element.width, element.height);
    else paintLoop(element, stroke.points);
  };

  return <canvas
    ref={canvas}
    className="draw-ink"
    data-tool={tool}
    onPointerDown={event => {
      event.currentTarget.setPointerCapture(event.pointerId);
      live.current = { id: crypto.randomUUID(), points: [here(event)], at: Date.now(), end: Date.now() };
    }}
    onPointerMove={event => {
      if (!live.current) return;
      const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const each of coalesced.length ? coalesced : [event.nativeEvent]) extend(here(each));
    }}
    onPointerUp={() => {
      const stroke = live.current;
      live.current = null;
      if (!stroke) return;
      if (tool === "pen") onStroke({ ...stroke, end: Date.now() });
      else { repaint(); onLoop(stroke.points); }
    }}
    onPointerCancel={() => { live.current = null; repaint(); }}
  />;
}

function paintLoop(element: HTMLCanvasElement, points: readonly Point[]) {
  const context = element.getContext("2d")!;
  const last = points[points.length - 1], before = points[points.length - 2];
  if (!before) return;
  context.strokeStyle = "#ffd84d";
  context.lineWidth = Math.max(2, element.width * 0.001);
  context.setLineDash([element.width * 0.004, element.width * 0.006]);
  context.beginPath();
  context.moveTo(before.x * element.width, before.y * element.height);
  context.lineTo(last.x * element.width, last.y * element.height);
  context.stroke();
  context.setLineDash([]);
}
