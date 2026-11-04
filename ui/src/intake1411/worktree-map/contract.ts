/** Owner-supplied, display-safe identities. Never pass filesystem paths or private labels. */
export interface VersionBranch {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly head: string | null;
  readonly lane: { readonly id: string; readonly label: string } | null;
  readonly worktree: { readonly id: string; readonly label: string } | null;
  readonly build: { readonly id: string; readonly revision: string } | null;
}

export interface VersionSnapshot {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly observedAt: string;
  readonly freshness: 'current' | 'stale';
  readonly main: { readonly id: string; readonly name: string; readonly revision: string };
  readonly branches: readonly VersionBranch[];
}

/** No git, branch control, storage, network or runtime model dependency in this view. */
export interface WorktreeMapAdapter {
  getSnapshot(): unknown;
  /** Notify after the owner has replaced its snapshot. Cleanup stops all view work. */
  subscribe(onChange: () => void): () => void;
}

export const worktreeMapFeature = Object.freeze({
  id: 'intake1411-worktree-map',
  title: 'Worktree map',
  defaultEnabled: false,
  ownerExtension: 'code-canvas',
});
