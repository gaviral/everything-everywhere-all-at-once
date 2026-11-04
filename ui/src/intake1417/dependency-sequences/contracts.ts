export type EvidenceState = "complete" | "pending" | "unknown";

/** IDs are supplied by the identity owner; this feature never creates or rewrites them. */
export interface DependencyPart {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  /** Repository-relative exact files or directory/** scopes; no other glob syntax. */
  readonly fileScopes: readonly string[];
  readonly prerequisites: readonly string[];
  readonly evidence: EvidenceState;
}

export interface DependencySnapshot {
  readonly revision: string;
  readonly parts: readonly DependencyPart[];
}

/** Read-only adapter. The host supplies its own canonical snapshot and owns its transport. */
export interface DependencyAdapter {
  readSnapshot(context: { signal: AbortSignal }): Promise<DependencySnapshot>;
  subscribe?(changed: () => void): () => void;
}

export interface SelectionStore {
  read(): string | null;
  write(id: string): void;
}

export type DependencyStatus = "ready" | "blocked" | "unknown" | "cyclic" | "complete";
export interface OrderedPart {
  readonly part: DependencyPart;
  readonly status: DependencyStatus;
  readonly reasons: readonly string[];
}
