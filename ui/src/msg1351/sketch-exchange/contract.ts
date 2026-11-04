export type Point = readonly [number, number];
export type Drawing = readonly (readonly Point[])[];
export interface Session { id: string; label: string }
export type Envelope = {
  exchangeId: string; from: string; to: string;
} & ({ kind: 'sketch'; drawing: Drawing } | { kind: 'receipt' } | { kind: 'reply'; drawing: Drawing });
/** The host authenticates `self`, enumerates live sessions and routes only to `to`.
 * send returning means queued, never received. Receipt comes from the destination.
 * No reconnect replay; messages and drawings are bounded and transient. */
export interface HostAdapter {
  self: Session;
  targets: readonly Session[];
  setEnabled(enabled: boolean): void;
  send(message: Envelope): void;
  subscribe(hear: (message: unknown) => void): () => void;
}
export function validDrawing(value: unknown): value is Drawing {
  if (!Array.isArray(value) || !value.length || value.length > 128) return false;
  let points = 0;
  return value.every(stroke => Array.isArray(stroke) && stroke.length > 0 &&
    (points += stroke.length) <= 2048 && stroke.every(p => Array.isArray(p) && p.length === 2 &&
      p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000) && p[1] <= 600));
}
export function validEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return ['exchangeId', 'from', 'to'].every(k => typeof m[k] === 'string' && (m[k] as string).length > 0 && (m[k] as string).length <= 128) &&
    (m.kind === 'receipt' || ((m.kind === 'sketch' || m.kind === 'reply') && validDrawing(m.drawing)));
}
export const sketchExchangeFeature = Object.freeze({
  id: 'sketch-exchange', name: 'Sketch exchange', defaultEnabled: false,
  control: 'setEnabled(boolean)', imageCapability: { available: false, reason: 'No validated image capability receipt.' },
});
