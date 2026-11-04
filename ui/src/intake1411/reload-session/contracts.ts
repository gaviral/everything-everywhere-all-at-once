export interface ReloadIdentity {
  mapId: string;
  sessionId: string;
  buildId: string;
}

export interface DraftValue {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
}

export interface ViewValue {
  viewId: string;
  camera: { x: number; y: number; zoom: number };
}

export type ReloadEvent<Snapshot = unknown> = { identity: ReloadIdentity } & (
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'build-start' }
  | { type: 'build-failed'; message: string }
  | { type: 'snapshot'; revision: string; payload: Snapshot }
);

/** The owner supplies actual events. This contract cannot launch or restart anything. */
export interface ReloadSource<Snapshot = unknown> {
  subscribe(listener: (event: ReloadEvent<Snapshot>) => void): () => void;
}

/** Restore methods must be passive: no send, focus change, permission request or microphone. */
export interface RecoveryHost<Snapshot = unknown> {
  readDraft(): DraftValue;
  readView(): ViewValue;
  restoreDraft(draft: DraftValue): void;
  restoreView(view: ViewValue): void;
  applySnapshot(snapshot: Snapshot, revision: string): void;
  subscribeChanges(listener: () => void): () => void;
}

/** Synchronous writes finish within the enabled call; no queued write can outlive disable. */
export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Checkpoint {
  version: 1;
  identity: ReloadIdentity;
  draft: DraftValue;
  view: ViewValue;
}

export type RecoveryPhase = 'ready' | 'rebuilding' | 'failed' | 'disconnected';
export interface RecoveryState {
  enabled: boolean;
  phase: RecoveryPhase;
  revision: string | null;
  message: string;
  checkpoint: 'none' | 'saved' | 'restored' | 'unavailable';
}
