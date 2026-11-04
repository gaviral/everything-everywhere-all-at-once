import type { DocumentEvent, SyncCursor } from "./contracts";
export type SyncSnapshot = { cursor: SyncCursor; events: DocumentEvent[] };
/** Contiguous, session-scoped log. Gaps wait for replay; duplicate versions never apply twice. */
export class SessionSync {
  private applied: DocumentEvent[] = [];
  private waiting = new Map<number, DocumentEvent>();
  constructor(readonly sessionId: string, snapshot?: SyncSnapshot) {
    if (snapshot) this.restore(snapshot);
  }
  private restore(snapshot: SyncSnapshot) {
    if (snapshot.cursor.schema !== 1 || snapshot.cursor.sessionId !== this.sessionId || snapshot.cursor.version !== snapshot.events.length) throw new Error("Invalid sync snapshot");
    for (const event of snapshot.events) {
      if (event.version !== this.applied.length + 1 || !this.receive(event)) throw new Error("Invalid sync log");
    }
  }
  receive(event: DocumentEvent): boolean {
    if (event.sessionId !== this.sessionId || !Number.isSafeInteger(event.version) || event.version < 1 || !event.id) return false;
    const existing = this.applied[event.version - 1] ?? this.waiting.get(event.version);
    if (existing) return existing.id === event.id && existing.text === event.text;
    if (this.applied.some(row => row.id === event.id) || [...this.waiting.values()].some(row => row.id === event.id)) return false;
    this.waiting.set(event.version, { ...event });
    this.drain();
    return true;
  }
  private drain() {
    for (;;) {
      const version = this.applied.length + 1, next = this.waiting.get(version);
      if (!next) return;
      this.waiting.delete(version); this.applied.push(next);
    }
  }
  cursor(): SyncCursor { return { schema: 1, sessionId: this.sessionId, version: this.applied.length }; }
  snapshot(): SyncSnapshot { return { cursor: this.cursor(), events: this.applied.map(event => ({ ...event })) }; }
  text() { return this.applied.map(event => event.text).join(" "); }
  pending() { return this.waiting.size; }
}
