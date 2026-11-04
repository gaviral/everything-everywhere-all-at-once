import type { InputSnapshot, OriginalStroke, PenDevicesAdapter, StrokeAcknowledgment } from "./contracts";

interface PreviewSnapshot extends InputSnapshot { readonly received: readonly OriginalStroke[] }

/** In-memory fixture only. A receipt here proves simulation, never a real transport or device. */
export class PreviewAdapter implements PenDevicesAdapter {
  private snapshot: PreviewSnapshot = { sessions: [
    { id: "studio-a", name: "Studio A", connected: true },
    { id: "studio-b", name: "Studio B", connected: true },
  ], touchAvailable: true, received: [] };
  private listeners = new Set<() => void>();
  private held = new Set<() => void>();
  hold = false;
  mismatch = false;
  get subscriberCount() { return this.listeners.size; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: PreviewSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  toggleConnection = (id: string) => {
    this.publish({ ...this.snapshot, sessions: this.snapshot.sessions.map(session => session.id === id
      ? { ...session, connected: !session.connected } : session) });
  };
  release = () => { for (const finish of [...this.held]) finish(); };
  sendStroke = (stroke: OriginalStroke, signal: AbortSignal): Promise<StrokeAcknowledgment> => new Promise((resolve, reject) => {
    const abort = () => { this.held.delete(finish); reject(new DOMException("Stopped", "AbortError")); };
    const finish = () => {
      this.held.delete(finish);
      signal.removeEventListener("abort", abort);
      if (signal.aborted || !this.snapshot.sessions.find(session => session.id === stroke.sessionId)?.connected) {
        reject(new Error("Disconnected")); return;
      }
      this.publish({ ...this.snapshot, received: [...this.snapshot.received, stroke] });
      resolve({ strokeId: this.mismatch ? "mismatched-stroke" : stroke.id,
        sessionId: stroke.sessionId, acceptedAtMs: Date.now() });
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    if (this.hold) this.held.add(finish);
    else queueMicrotask(finish);
  });
}
