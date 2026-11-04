import { useEffect, useReducer } from 'react';
import type { SketchSessionAdapter } from './SketchSessionAdapter';
import { DrawingSurface, StrokePaths } from './DrawingSurface';
import { StrokeReceipt } from './StrokeReceipt';
import { originalStrokes, visibleStrokes } from './StrokeProjection';
import type { DrawingSnapshot } from './contract';
import './shared-drawing.css';

function DestinationChoice({ adapter }: { adapter: SketchSessionAdapter }) {
  return <label className="sd-destination">Destination session
    <select disabled={!adapter.enabled} value={adapter.selectedId} onChange={event => adapter.select(event.target.value)}>
      <option value="" disabled>Choose a session…</option>
      {adapter.port.destinations.map(session => <option key={session.id} value={session.id}>{session.label}</option>)}
    </select>
  </label>;
}
function OriginalHistory({ snapshot }: { snapshot: DrawingSnapshot }) {
  return <details className="sd-history"><summary>Preserved original marks</summary>
    <svg className="sd-paper" viewBox="0 0 1000 600" role="img" aria-label="Preserved original marks"><StrokePaths strokes={originalStrokes(snapshot.entries)} /></svg>
  </details>;
}
/** Transport and adapter lifetimes belong to the host, above navigable views. */
export function SharedDrawingView({ adapter }: { adapter: SketchSessionAdapter }) {
  const [, render] = useReducer(value => value + 1, 0);
  useEffect(() => adapter.watch(render), [adapter]);
  return <section className="shared-drawing" aria-label="Shared drawing">
    <header><div><p className="sd-eyebrow">Shared explanation</p><h1>One session. Every mark.</h1></div>
      <label className="sd-switch"><input type="checkbox" checked={adapter.enabled} onChange={event => adapter.setEnabled(event.target.checked)} />Shared drawing {adapter.enabled ? 'on' : 'off'}</label>
    </header>
    <DestinationChoice adapter={adapter} />
    <StrokeReceipt snapshot={adapter.snapshot} enabled={adapter.enabled} />
    {adapter.notice && <p role="alert">{adapter.notice}</p>}
    <DrawingSurface key={adapter.selectedId} entries={adapter.snapshot.entries} disabled={!adapter.enabled || !adapter.selectedId} onDraw={(points, correction) => adapter.draw(points, correction)} />
    <button className="sd-undo" disabled={!adapter.enabled || !visibleStrokes(adapter.snapshot.entries).length} onClick={() => adapter.undo()}>Undo last stroke</button>
    <OriginalHistory snapshot={adapter.snapshot} />
  </section>;
}
