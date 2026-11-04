import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { MAX_OPERATIONS, MAX_POINTS, type Point, type StrokeEntry } from './contract';
import { PointerStroke, surfacePoint } from './PointerStroke';
import { visibleStrokes, type Stroke } from './StrokeProjection';

export function StrokePaths({ strokes }: { strokes: readonly Stroke[] }) {
  return <>{strokes.map(stroke => stroke.points.length === 1
    ? <circle key={stroke.id} data-stroke-id={stroke.id} cx={stroke.points[0][0]} cy={stroke.points[0][1]} r="3" />
    : <polyline key={stroke.id} data-stroke-id={stroke.id} points={stroke.points.map(point => point.join(',')).join(' ')} />)}</>;
}
export function DrawingSurface({ entries, disabled, onDraw }: {
  entries: readonly StrokeEntry[]; disabled: boolean; onDraw: (points: readonly Point[], correction: boolean) => void;
}) {
  const pointer = useRef(new PointerStroke());
  const [draft, setDraft] = useState<readonly Point[]>([]);
  const [correction, setCorrection] = useState(false);
  const strokes = visibleStrokes(entries);
  const remaining = MAX_POINTS - entries.reduce((n, entry) => n + (entry.operation.kind === 'stroke' ? entry.operation.points.length : 0), 0);
  const full = remaining < 1 || entries.length >= MAX_OPERATIONS;
  const cancel = () => { pointer.current.cancel(); setDraft([]); };
  useEffect(() => { if (disabled) { pointer.current.cancel(); setDraft([]); } }, [disabled]);
  const addPoint = (event: PointerEvent<SVGSVGElement>) => {
    if (!disabled && !full) setDraft([...pointer.current.move(event.pointerId, surfacePoint(event.currentTarget, event.clientX, event.clientY), remaining)]);
  };
  return <fieldset className="sd-surface" disabled={disabled || full}>
    <legend>Draw your explanation</legend>
    <svg viewBox="0 0 1000 600" preserveAspectRatio="none" role="img" aria-label="Editable drawing" className="sd-paper sd-input"
      onPointerDown={event => {
        if (disabled || full || (event.pointerType === 'mouse' && event.button !== 0)) return;
        if (!pointer.current.begin(event.pointerId, surfacePoint(event.currentTarget, event.clientX, event.clientY))) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraft([...pointer.current.points]);
      }} onPointerMove={addPoint} onPointerUp={event => {
        if (disabled || full) { cancel(); return; }
        addPoint(event);
        const points = pointer.current.end(event.pointerId);
        if (points?.length) { onDraw(points, correction); setCorrection(false); setDraft([]); }
      }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      <StrokePaths strokes={strokes} />
      {draft.length > 0 && <polyline className="sd-draft" points={draft.map(point => point.join(',')).join(' ')} />}
    </svg>
    <div className="sd-tools">
      <button type="button" disabled={remaining < 5} onClick={() => { onDraw([[180, 140], [800, 140], [800, 440], [180, 440], [180, 140]], correction); setCorrection(false); }}>Add example box</button>
      <button type="button" disabled={!strokes.length} aria-pressed={correction} onClick={() => setCorrection(!correction)}>Correct last stroke</button>
    </div>
    <p className="sd-hint">{full ? 'This sketch is full; originals are kept.' : correction ? 'Draw a replacement. The original stays in history.' : 'Use touch, pen or pointer. Add an example box with the keyboard.'}</p>
  </fieldset>;
}
