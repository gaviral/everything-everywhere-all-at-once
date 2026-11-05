import type { RecoveryHost, ReloadEvent } from './contracts';
import { CheckpointStore } from './CheckpointStore';
import { ReloadIdentity } from './ReloadIdentity';
import { ReloadState } from './ReloadState';

/** Each enable creates a driver; dispose also invalidates callbacks already queued by a source. */
export class ReloadDriver<Snapshot> {
  private active = true;
  private pendingRestore = true;
  private applying = false;
  private changedWhileWaiting = false;

  constructor(private identity: ReloadIdentity, private host: RecoveryHost<Snapshot>,
    private checkpoints: CheckpointStore, private state: ReloadState) {}

  dispose(): void { this.active = false; }

  changed = (): void => {
    if (!this.active || this.applying) return;
    // A new user edit wins over an older checkpoint, even while disconnected.
    if (this.pendingRestore) this.changedWhileWaiting = true;
    this.save();
  };

  receive = (event: ReloadEvent<Snapshot>): void => {
    if (!this.active || !this.identity.accepts(event.identity)) return;
    if (event.type === 'snapshot') { this.acceptSnapshot(event); return; }
    if (event.type === 'connected') {
      this.state.update({ message: 'Connected; waiting for a matching snapshot.' });
      return;
    }
    this.pendingRestore = true;
    if (event.type === 'disconnected') {
      this.state.update({ phase: 'disconnected', message: 'Waiting for reconnect; keeping the last view.' });
    } else if (event.type === 'build-start') {
      this.state.update({ phase: 'rebuilding', message: 'Build started; keeping the last view.' });
    } else {
      this.state.update({ phase: 'failed', message: event.message.slice(0, 300) || 'The build reported an error.' });
    }
  };

  private acceptSnapshot(event: Extract<ReloadEvent<Snapshot>, { type: 'snapshot' }>): void {
    if (!event.revision.trim()) return;
    try {
      this.applying = true;
      this.host.applySnapshot(event.payload, event.revision);
      if (!this.active) return;
      if (this.pendingRestore && !this.changedWhileWaiting) this.restore();
      if (!this.active) return;
      this.pendingRestore = false;
      this.changedWhileWaiting = false;
      this.state.update({ phase: 'ready', revision: event.revision, message: 'Matching snapshot received.' });
    } catch {
      if (this.active) this.state.update({ phase: 'failed', message: 'The snapshot could not be applied.' });
    } finally { this.applying = false; }
  }

  private restore(): void {
    try {
      const checkpoint = this.checkpoints.read();
      if (checkpoint) {
        this.checkpoints.restore(this.host, checkpoint, () => this.active);
        if (this.active) this.state.update({ checkpoint: 'restored' });
      }
    } catch {
      if (this.active) this.state.update({ checkpoint: 'unavailable' });
    }
  }

  private save(): void {
    try {
      this.checkpoints.save(this.host);
      if (this.active && this.state.get().checkpoint !== 'restored') this.state.update({ checkpoint: 'saved' });
    } catch {
      if (this.active) this.state.update({ checkpoint: 'unavailable' });
    }
  }
}
