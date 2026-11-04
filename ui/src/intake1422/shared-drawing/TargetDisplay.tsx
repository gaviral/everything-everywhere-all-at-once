import { useEffect, useReducer } from 'react';
import type { DrawingSessionPort } from './contract';
import { StrokePaths } from './DrawingSurface';
import { visibleStrokes } from './StrokeProjection';

export function TargetDisplay({ port }: { port: DrawingSessionPort }) {
  const [, render] = useReducer(value => value + 1, 0);
  useEffect(() => port.subscribe(render), [port]);
  const snapshot = port.snapshot(port.self.id);
  const entries = snapshot.entries.filter(entry => entry.acknowledged);
  return <section className="sd-target" aria-label={port.self.label}>
    <p className="sd-eyebrow">Target display</p><h2>{port.self.label}</h2>
    <p>{snapshot.connected ? 'Connected' : 'Disconnected'} · {entries.length} accepted operations</p>
    <svg className="sd-paper" viewBox="0 0 1000 600" role="img" aria-label={`${port.self.label} drawing`}><StrokePaths strokes={visibleStrokes(entries)} /></svg>
    <p className="sd-empty">{entries.length ? 'Original stroke IDs preserved from the selected session.' : 'No strokes received in this session.'}</p>
    <ol className="sd-target-ids">{entries.map(({ operation }) => <li key={operation.id}><code>{operation.id}</code></li>)}</ol>
  </section>;
}
