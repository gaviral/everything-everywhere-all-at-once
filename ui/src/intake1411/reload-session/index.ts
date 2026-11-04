import type { RecoveryHost, RecoveryStorage, ReloadIdentity as Identity, ReloadSource } from './contracts';
import { ReloadIdentity } from './ReloadIdentity';
import { CheckpointStore } from './CheckpointStore';
import { ReloadState } from './ReloadState';
import { RecoverySwitch } from './RecoverySwitch';

export const reloadSessionFeature = Object.freeze({
  id: 'intake1411-reload-session', name: 'Reload recovery', defaultEnabled: false,
  description: 'Keep an unsent draft and view for the selected map, session and build.',
});

export function createReloadSession<Snapshot>(ports: {
  identity: Identity; host: RecoveryHost<Snapshot>; source: ReloadSource<Snapshot>; storage: RecoveryStorage;
}) {
  const identity = new ReloadIdentity(ports.identity);
  const state = new ReloadState();
  const checkpoints = new CheckpointStore(identity, ports.storage);
  const recovery = new RecoverySwitch(identity, ports.host, ports.source, checkpoints, state);
  return { feature: reloadSessionFeature, state, setEnabled: (enabled: boolean) => recovery.setEnabled(enabled),
    dispose: () => recovery.dispose() };
}

export type * from './contracts';
export { describeReloadState } from './ReloadState';
