export type InputDevice = "pointer" | "touch";
export interface SessionDestination { readonly id: string; readonly name: string; readonly connected: boolean }
export interface InputSnapshot { readonly sessions: readonly SessionDestination[]; readonly touchAvailable: boolean }
export interface StrokePoint {
  /** Fractions of the drawing surface at pointerdown; raw browser samples remain alongside them. */
  readonly x: number; readonly y: number;
  readonly clientX: number; readonly clientY: number;
  readonly timeStamp: number; readonly pressure: number;
}
export interface OriginalStroke {
  readonly id: string; readonly sessionId: string; readonly device: InputDevice;
  readonly pointerType: string; readonly pointerId: number; readonly timeOrigin: number;
  readonly surface: Readonly<{ left: number; top: number; width: number; height: number }>;
  readonly points: readonly StrokePoint[];
}
export interface StrokeAcknowledgment {
  readonly strokeId: string; readonly sessionId: string; readonly acceptedAtMs: number;
}
/** Host bridges its existing D20 transport to D75. This lane creates no transport or destination.
 * getSnapshot must return the same object until state changes. sendStroke must forward the original
 * payload and resolve only on destination acknowledgment, respect abort, and never silently retarget.
 * The host owns durable retention; this input part never deletes destination data or retries sends.
 */
export interface PenDevicesAdapter {
  getSnapshot(): InputSnapshot;
  subscribe(listener: () => void): () => void;
  sendStroke(stroke: OriginalStroke, signal: AbortSignal): Promise<StrokeAcknowledgment>;
}
export const penDevicesFeature = Object.freeze({
  id: "intake1411-pen-devices", title: "Pen and touch input", defaultEnabled: false,
});
