import { useRef, useState, type PointerEvent } from 'react';
import type { Drawing, Point } from './contract';
export function DrawingView({ drawing, label }: { drawing: Drawing; label: string }) {
  return <figure className="sketch-visual"><figcaption>{label}</figcaption><svg viewBox="0 0 1000 600" role="img" aria-label={label} className="sketch-image">
    {drawing.map((s, i) => <polyline key={i} points={s.map(p => p.join(',')).join(' ')} />)}
  </svg></figure>;
}
export function SketchCapture({ label, drawing, onChange, disabled = false }: {
  label: string; drawing: Drawing; onChange: (value: Drawing) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<readonly Point[]>([]);
  const active = useRef<{ id: number; points: Point[] } | null>(null);
  const point = (e: PointerEvent<SVGSVGElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(1000, (e.clientX - r.left) / r.width * 1000))),
      Math.round(Math.max(0, Math.min(600, (e.clientY - r.top) / r.height * 600)))];
  };
  const count = drawing.reduce((sum, stroke) => sum + stroke.length, 0);
  const cancel = () => { active.current = null; setDraft([]); };
  return <fieldset disabled={disabled} className="sketch-capture"><legend>{label}</legend>
    <svg viewBox="0 0 1000 600" role="img" aria-label={`${label} drawing surface`} className="sketch-image sketch-pad"
      onPointerDown={e => {
        if (disabled || active.current || drawing.length >= 128 || count >= 2047) return;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        active.current = { id: e.pointerId, points: [point(e)] }; setDraft([...active.current.points]);
      }}
      onPointerMove={e => {
        const stroke = active.current;
        if (disabled || !stroke || stroke.id !== e.pointerId || count + stroke.points.length >= 2047) return;
        stroke.points.push(point(e)); setDraft([...stroke.points]);
      }}
      onPointerUp={e => {
        const stroke = active.current;
        if (stroke?.id === e.pointerId) {
          if (!disabled) onChange([...drawing, [...stroke.points, point(e)]]);
          cancel();
        }
      }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {[...drawing, draft].map((s, i) => <polyline key={i} points={s.map(p => p.join(',')).join(' ')} />)}
    </svg>
    <div className="sketch-actions">
      <button type="button" disabled={drawing.length >= 128 || count > 2043} onClick={() => onChange([...drawing, [[200,150],[800,150],[800,450],[200,450],[200,150]]])}>Add box</button>
      <button type="button" disabled={!drawing.length} onClick={() => onChange(drawing.slice(0,-1))}>Undo stroke</button>
      <button type="button" disabled={!drawing.length} onClick={() => onChange([])}>Clear drawing</button>
    </div><small>Draw with touch, pen or pointer. Add box also works with a keyboard.</small>
  </fieldset>;
}
