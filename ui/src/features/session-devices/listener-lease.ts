import type { Lease, ListenerAuthority, LocalConfirmation } from "./contracts";
/** Synthetic fixture authority only. JS calls serialize here; a hosted adapter must use
 * the atomic Rust authority or an equivalent server transaction, never browser replicas. */
export class SyntheticListenerAuthority implements ListenerAuthority {
  private states = new Map<string, { fence: number; lease: Lease | null }>();
  constructor(private readonly duration = 5000) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid lease duration");
  }
  inspect(sessionId: string, now: number) {
    const state = this.states.get(sessionId) ?? { fence: 0, lease: null };
    if (state.lease && state.lease.expiresAt <= now) { state.lease = null; state.fence++; }
    this.states.set(sessionId, state);
    return { fence: state.fence, lease: state.lease ? { ...state.lease } : null };
  }
  grant(confirmation: LocalConfirmation, now: number) {
    const state = this.inspect(confirmation.sessionId, now);
    if (state.lease || state.fence !== confirmation.expectedFence) return null;
    const lease: Lease = { ...confirmation, fence: state.fence + 1, expiresAt: now + this.duration };
    this.states.set(confirmation.sessionId, { fence: lease.fence, lease });
    return { ...lease };
  }
  release(sessionId: string, fence: number, now: number) {
    const state = this.inspect(sessionId, now);
    if (state.lease?.fence === fence) this.states.set(sessionId, { fence: state.fence + 1, lease: null });
  }
}
