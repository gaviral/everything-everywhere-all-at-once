import type { DrawingSessionPort, Session } from './contract';
import { PreviewDocument } from './PreviewDocument';

/** Deterministic in-memory fixture: isolated session documents, no network/audio. */
export class PreviewSessionHost {
  private documents: Map<string, PreviewDocument>;
  private enabled = new Set<string>();
  private offline = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(readonly sessions: readonly Session[]) {
    this.documents = new Map(sessions.map(session => [session.id, new PreviewDocument(session.id, `sketch-${session.id}`)]));
  }
  private available(id: string) { return this.enabled.has(id) && !this.offline.has(id); }
  private document(id: string) {
    const document = this.documents.get(id);
    if (!document) throw new Error('Unknown destination session.');
    return document;
  }
  private changed() {
    for (const [id, document] of this.documents) {
      document.acknowledge(authorId => this.available(id) && this.available(authorId));
    }
    this.listeners.forEach(listener => listener());
  }
  setConnected(id: string, connected: boolean) {
    if (connected) this.offline.delete(id); else this.offline.add(id);
    this.changed();
  }
  port(self: Session): DrawingSessionPort {
    return {
      self, destinations: this.sessions,
      snapshot: sessionId => ({ exchangeId: this.document(sessionId).exchangeId, connected: this.available(self.id) && this.available(sessionId), entries: this.document(sessionId).read(self.id) }),
      submit: operation => {
        if (!this.enabled.has(self.id) || operation.authorId !== self.id) throw new Error('Drawing is off or sender does not match.');
        this.document(operation.sessionId).append(operation); this.changed();
      },
      subscribe: changed => { this.listeners.add(changed); return () => { this.listeners.delete(changed); }; },
      setEnabled: enabled => { if (enabled) this.enabled.add(self.id); else this.enabled.delete(self.id); this.changed(); },
    };
  }
}
