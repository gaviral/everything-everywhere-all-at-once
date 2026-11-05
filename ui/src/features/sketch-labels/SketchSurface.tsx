import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Point, Selection, Stroke } from './contracts';
import type { SketchLabelsController, SketchLabelsState } from './controller';
import type { SelectionMode } from './SelectionTools';
import { annotationView } from './AnnotationView';

const pointsText = (points: readonly Point[]) => points.map(point => `${point.x},${point.y}`).join(' ');
function targetOrigin(target: Selection, strokes: readonly Stroke[]): Point | null {
  if (target.kind === 'region') return target.region.bounds;
  return strokes.find(stroke => stroke.id === target.strokeIds[0])?.points[0] ?? null;
}
function surfacePoint(event: PointerEvent<SVGSVGElement>): Point {
  const matrix = event.currentTarget.getScreenCTM();
  if (!matrix) throw new Error('The drawing surface is unavailable.');
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: Math.max(0, Math.min(640, point.x)), y: Math.max(0, Math.min(340, point.y)) };
}

export function SketchSurface({ state, controller, mode, run }: {
  state: SketchLabelsState; controller: SketchLabelsController; mode: SelectionMode; run: (operation: () => void) => void;
}) {
  const gesture = useRef<{ pointer: number; points: Point[] } | null>(null);
  const [trail, setTrail] = useState<readonly Point[]>([]);
  const clear = () => { gesture.current = null; setTrail([]); };
  const selected = state.selection?.kind === 'strokes' ? state.selection.strokeIds : [];
  return <svg className="sketch-labels-surface" viewBox="0 0 640 340" tabIndex={0} role="group" aria-label="Sketch selection surface" aria-describedby="sketch-labels-selection-help"
    onKeyDown={event => { if (event.key === 'Escape') { clear(); run(() => controller.clearSelection()); } }}
    onPointerDown={event => {
      if (event.button !== 0 || gesture.current) return;
      const point = surfacePoint(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointer: event.pointerId, points: [point] };
      setTrail([point]);
    }}
    onPointerMove={event => {
      if (gesture.current?.pointer !== event.pointerId) return;
      if (gesture.current.points.length < 2048) gesture.current.points.push(surfacePoint(event));
      setTrail([...gesture.current.points]);
    }}
    onPointerUp={event => {
      if (gesture.current?.pointer !== event.pointerId) return;
      const points = [...gesture.current.points, surfacePoint(event)];
      clear();
      run(() => mode === 'lasso' ? controller.lasso(points) : controller.highlight(points[0], points[points.length - 1]));
    }} onPointerCancel={clear} onLostPointerCapture={clear}>
    <title>Original drawing with selected marks and annotation markers</title>
    <rect width="640" height="340" rx="12" className="sketch-labels-paper" />
    <text x="335" y="235" className="sketch-labels-context">Sample content</text>
    {state.annotations.filter(annotation => annotation.anchor.target.kind === 'region').map(annotation => {
      const target = annotation.anchor.target;
      return target.kind === 'region' && <rect key={annotation.id} {...target.region.bounds} className="sketch-labels-highlight" data-annotation-id={annotation.id} />;
    })}
    {state.session.strokes.map(stroke => <g key={stroke.id} data-mark-id={stroke.id} data-selected={selected.includes(stroke.id)}>
      {selected.includes(stroke.id) && <polyline points={pointsText(stroke.points)} className="sketch-labels-selected-mark" />}
      <polyline points={pointsText(stroke.points)} className="sketch-labels-original-mark" />
      <text x={stroke.points[0].x} y={stroke.points[0].y + 30} className="sketch-labels-mark-name">{stroke.id}</text>
    </g>)}
    {state.selection?.kind === 'region' && <rect {...state.selection.region.bounds} className="sketch-labels-selected-region" />}
    {state.annotations.map((annotation, index) => {
      const point = targetOrigin(annotation.anchor.target, state.session.strokes);
      const view = annotationView(annotation, state.session);
      return point && <g key={view.id} data-annotation-id={view.id} aria-label={`${view.label}. ${view.targetText}. Stroke time ${view.strokeTimeText}. Reference time ${view.referenceTimeText}.`}>
        <title>{view.label} · {view.targetText} · Stroke time {view.strokeTimeText} · Reference time {view.referenceTimeText}</title>
        <circle cx={point.x - 12} cy={Math.max(16, point.y - 14)} r="13" className="sketch-labels-marker" />
        <text x={point.x - 12} y={Math.max(16, point.y - 14) + 4} textAnchor="middle" className="sketch-labels-marker-number">{index + 1}</text>
      </g>;
    })}
    {trail.length > 1 && (mode === 'lasso' ? <polygon points={pointsText(trail)} className="sketch-labels-selected-region" /> : <rect x={Math.min(trail[0].x, trail[trail.length - 1].x)} y={Math.min(trail[0].y, trail[trail.length - 1].y)} width={Math.abs(trail[0].x - trail[trail.length - 1].x)} height={Math.abs(trail[0].y - trail[trail.length - 1].y)} className="sketch-labels-selected-region" />)}
  </svg>;
}
