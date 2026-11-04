import type { RecoveryHost, ReloadSource } from './contracts';
import { CheckpointStore } from './CheckpointStore';
import { ReloadDriver } from './ReloadDriver';
import { ReloadIdentity } from './ReloadIdentity';
import { ReloadState } from './ReloadState';

export class RecoverySwitch<Snapshot> {
  private driver: ReloadDriver<Snapshot> | null = null;
  private cancellations: (() => void)[] = [];

  constructor(private identity: ReloadIdentity, private host: RecoveryHost<Snapshot>,
    private source: ReloadSource<Snapshot>, private checkpoints: CheckpointStore,
    private state: ReloadState) {}

  setEnabled(enabled: boolean): void {
    if (enabled === !!this.driver) return;
    if (!enabled) { this.stop(); return; }
    const driver = new ReloadDriver(this.identity, this.host, this.checkpoints, this.state);
    this.driver = driver;
    this.state.update({ enabled: true, phase: 'disconnected', message: 'Waiting for a matching snapshot.' });
    try {
      this.addCancellation(this.host.subscribeChanges(driver.changed), driver);
      if (this.driver === driver) this.addCancellation(this.source.subscribe(driver.receive), driver);
    } catch {
      this.stop();
      this.state.update({ message: 'Recovery could not attach to the selected session.' });
    }
  }

  dispose(): void { this.stop(); }

  private addCancellation(cancel: () => void, driver: ReloadDriver<Snapshot>): void {
    if (this.driver === driver) this.cancellations.push(cancel);
    else cancel();
  }

  private stop(): void {
    this.driver?.dispose();
    this.driver = null;
    const cancellations = this.cancellations.splice(0);
    for (const cancel of cancellations) { try { cancel(); } catch { /* Already invalidated. */ } }
    this.state.update({ enabled: false, message: 'Recovery is off; saved drafts are kept.' });
  }
}
