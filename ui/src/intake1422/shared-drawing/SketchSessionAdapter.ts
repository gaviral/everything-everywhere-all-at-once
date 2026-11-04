import { MAX_OPERATIONS, MAX_POINTS, validOperation, type DrawingOperation, type DrawingSessionPort, type DrawingSnapshot, type Point } from './contract';
import { visibleStrokes } from './StrokeProjection';

const empty: DrawingSnapshot = { exchangeId: '', connected: false, entries: [] };
/** View-lifetime selection and commands; the injected port owns the document. */
export class SketchSessionAdapter {
  enabled = false;
  selectedId = '';
  notice = '';
  snapshot: DrawingSnapshot = empty;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  constructor(readonly port: DrawingSessionPort, private nextId: () => string = () => crypto.randomUUID()) {}
  watch(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.listeners.forEach(listener => listener()); }
  private refresh = () => {
    try { this.snapshot = this.selectedId ? this.port.snapshot(this.selectedId) : empty; }
    catch { this.snapshot = { ...this.snapshot, connected: false }; this.notice = 'Session unavailable. Your drawing is kept.'; }
    this.changed();
  };
  select(sessionId: string) {
    if (!this.enabled || !this.port.destinations.some(session => session.id === sessionId)) return;
    if (sessionId !== this.selectedId) this.snapshot = empty;
    this.selectedId = sessionId;
    this.notice = '';
    this.refresh();
  }
  setEnabled(enabled: boolean) {
    this.unsubscribe?.(); this.unsubscribe = undefined; this.enabled = false;
    try {
      this.port.setEnabled(enabled);
      if (enabled) this.unsubscribe = this.port.subscribe(this.refresh);
      this.enabled = enabled;
      this.notice = '';
      if (enabled) this.refresh();
    } catch {
      this.notice = 'Connection unavailable. Shared drawing stays off; your drawing is kept.';
      try { this.port.setEnabled(false); } catch { /* Local work stays off. */ }
    }
    this.changed();
  }
  private identity() {
    return { id: this.nextId(), exchangeId: this.snapshot.exchangeId, sessionId: this.selectedId, authorId: this.port.self.id };
  }
  private append(operation: DrawingOperation) {
    if (!this.enabled || !this.selectedId || !validOperation(operation)) return;
    const entries = this.snapshot.entries;
    const pointCount = entries.reduce((n, entry) => n + (entry.operation.kind === 'stroke' ? entry.operation.points.length : 0), 0);
    if (entries.length >= MAX_OPERATIONS || (operation.kind === 'stroke' && pointCount + operation.points.length > MAX_POINTS)) {
      this.notice = 'This sketch is full. Choose another session; all originals are kept.';
      this.changed(); return;
    }
    try { this.port.submit(operation); this.notice = ''; }
    catch { this.notice = 'Stroke was not queued. Your existing drawing is kept; draw again to retry.'; }
    this.refresh();
  }
  draw(points: readonly Point[], correctLast = false) {
    const last = visibleStrokes(this.snapshot.entries).at(-1);
    this.append({ ...this.identity(), kind: 'stroke', points, ...(correctLast && last ? { replaces: last.id } : {}) });
  }
  undo() {
    const last = visibleStrokes(this.snapshot.entries).at(-1);
    if (last) this.append({ ...this.identity(), kind: 'undo', strokeId: last.id });
  }
  dispose() { this.setEnabled(false); this.listeners.clear(); }
}
