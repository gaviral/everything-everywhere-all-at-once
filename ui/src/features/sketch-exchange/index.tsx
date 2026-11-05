import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Drawing, HostAdapter } from './contract';
import { SketchTransport } from './SketchTransport';
import { SketchCapture, DrawingView } from './SketchCapture';
import { TargetSession } from './TargetSession';
import { VisualReply } from './VisualReply';
import './sketch-exchange.css';
export { sketchExchangeFeature } from './contract';
export type { HostAdapter, Envelope, Session, Drawing } from './contract';
export function SketchExchange({ adapter, role }: { adapter: HostAdapter; role: 'capture' | 'display' }) {
  const transport = useMemo(() => new SketchTransport(adapter), [adapter]);
  const [, render] = useReducer(n => n + 1, 0);
  const [drawing, setDrawing] = useState<Drawing>([]);
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { const off = transport.watch(render); return () => { off(); transport.dispose(); }; }, [transport]);
  const invoke = (action: () => unknown) => { try { action(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send. Your drawing is kept.'); } };
  const name = (id: string) => adapter.self.id === id ? adapter.self.label : adapter.targets.find(s => s.id === id)?.label ?? 'Previous session';
  return <section className="sketch-exchange" aria-label={adapter.self.label}>
    <header><h2>{adapter.self.label}</h2><label className="sketch-switch"><input type="checkbox" checked={transport.enabled} onChange={e => transport.setEnabled(e.target.checked)} />Sketch exchange {transport.enabled ? 'on' : 'off'}</label></header>
    <p role="status">{transport.notice}</p>{error && <p role="alert">{error}</p>}
    {role === 'capture' && <><p>Source: <strong>{adapter.self.label}</strong></p>
      <SketchCapture label="Original sketch" drawing={drawing} onChange={setDrawing} disabled={!transport.enabled} />
      <TargetSession targets={adapter.targets} selected={target} onSelect={setTarget} disabled={!transport.enabled} />
      <button disabled={!transport.enabled || !target || !drawing.length} onClick={() => invoke(() => transport.send(target, drawing))}>Send sketch</button></>}
    {!transport.exchanges.length && <p className="sketch-empty">{role === 'display' ? 'No sketch received in this display.' : 'Your sent originals and replies will appear here.'}</p>}
    {transport.exchanges.map((exchange, i) => <article key={exchange.id} aria-label={`Exchange ${i + 1}`}>
      <h3>Sketch {i + 1} · {name(exchange.source)} → {name(exchange.target)}</h3>
      <p>{exchange.received ? 'Receipt confirmed' : 'Awaiting destination receipt'}</p>
      <DrawingView drawing={exchange.original} label="Preserved original sketch" />
      {exchange.target === adapter.self.id ? <VisualReply exchange={exchange} enabled={transport.enabled} onReply={value => invoke(() => transport.reply(exchange.id, value))} /> : exchange.reply && <DrawingView drawing={exchange.reply} label="Visual reply from selected display" />}
    </article>)}
    <p className="sketch-capability">Manual diagrams available. Image generation unavailable.</p>
  </section>;
}
