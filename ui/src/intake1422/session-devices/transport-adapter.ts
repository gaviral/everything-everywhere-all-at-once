import type { TransportAdapter, TransportEvent } from "./contracts";
import { SessionSync } from "./session-sync";
/** Owns subscription lifetime only; no socket creation or endpoint registration. */
export class TransportSubscription {
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly transport: TransportAdapter, private readonly receive: (event: TransportEvent) => void) {}
  start(sessions: Iterable<SessionSync>) {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.subscribe(this.receive);
    for (const sync of sessions) this.resume(sync);
  }
  resume(sync: SessionSync) { if (this.unsubscribe) this.transport.resume(sync.cursor()); }
  stop() { this.unsubscribe?.(); this.unsubscribe = null; }
}
