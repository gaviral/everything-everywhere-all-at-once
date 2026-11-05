import type { RecoveryState } from './contracts';

export class ReloadState {
  private value: RecoveryState = { enabled: false, phase: 'disconnected', revision: null,
    message: 'Recovery is off.', checkpoint: 'none' };
  private listeners = new Set<(state: Readonly<RecoveryState>) => void>();

  get(): Readonly<RecoveryState> { return { ...this.value }; }

  update(change: Partial<RecoveryState>): void {
    this.value = { ...this.value, ...change };
    for (const listener of this.listeners) listener(this.get());
  }

  subscribe(listener: (state: Readonly<RecoveryState>) => void): () => void {
    this.listeners.add(listener);
    listener(this.get());
    return () => { this.listeners.delete(listener); };
  }
}

export function describeReloadState(state: Readonly<RecoveryState>): string {
  if (!state.enabled) return 'Recovery off · saved drafts are kept';
  const label = { ready: 'Ready', rebuilding: 'Rebuilding', failed: 'Build failed',
    disconnected: 'Disconnected' }[state.phase];
  return `${label}${state.revision ? ` · last healthy ${state.revision}` : ''} · ${state.message}`;
}
