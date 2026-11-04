import type { ReloadEvent, ReloadIdentity, ReloadSource } from './contracts';

export interface PreviewSnapshot { label: string }

/** Controlled test source, with no process, network or permission APIs. */
export class PreviewDriver implements ReloadSource<PreviewSnapshot> {
  private listeners = new Set<(event: ReloadEvent<PreviewSnapshot>) => void>();
  private revision = 0;

  constructor(readonly identity: ReloadIdentity) {}

  subscribe(listener: (event: ReloadEvent<PreviewSnapshot>) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'snapshot', identity: this.identity, revision: 'preview-0', payload: { label: 'Sample garden' } });
    return () => { this.listeners.delete(listener); };
  }

  emit(event: ReloadEvent<PreviewSnapshot>): void {
    for (const listener of this.listeners) listener(event);
  }

  signal(type: 'connected' | 'disconnected' | 'build-start'): void {
    this.emit({ type, identity: this.identity });
  }

  fail(): void {
    this.emit({ type: 'build-failed', identity: this.identity, message: 'Synthetic build error. The last healthy view is still here.' });
  }

  snapshot(mismatch = 'matching'): void {
    const identity = { ...this.identity };
    if (mismatch === 'mapId' || mismatch === 'sessionId' || mismatch === 'buildId') identity[mismatch] = 'other';
    this.emit({ type: 'snapshot', identity, revision: `preview-${++this.revision}`, payload: { label: 'Sample garden' } });
  }
}
