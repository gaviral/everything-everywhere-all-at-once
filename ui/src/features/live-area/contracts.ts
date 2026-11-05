/** Host adapters provide permitted, redacted display text only. No producer or transport lives here. */
export type RunIdentity = Readonly<{ runId: string; branchId: string; buildId: string }>;
export type EventStamp = Readonly<{ identity: RunIdentity; sequence: number; observedAt: number }>;
export type ActivityEvent = EventStamp & Readonly<{
  agentId: string; agentName: string; task: string;
  state: "queued" | "running" | "waiting" | "done" | "failed" | "stopped";
}>;
export type BuildEvent = EventStamp & Readonly<{
  state: "building" | "ready" | "reloading" | "failed"; label: string;
}>;
export type VersionEvent = EventStamp & Readonly<{
  branchLabel: string; worktreeLabel: string; revision: string;
}>;
export type Connection = "connected" | "disconnected" | "unavailable";
export type SourceObserver<T> = Readonly<{ connection(state: Connection): void; event(event: T): void }>;
/** A subscription observes existing work. Unsubscribe releases every resource it acquired.
 * sequence increases per record over reconnects; a restarted run uses a new runId.
 * connected begins a new connection epoch. Replay must be newer than retained records.
 * observedAt is a Unix millisecond timestamp. Identity is immutable for a record.
 */
export interface StatusSource<T> { subscribe(observer: SourceObserver<T>): () => void }
export interface LiveAreaAdapters {
  activity?: StatusSource<ActivityEvent>;
  build?: StatusSource<BuildEvent>;
  version?: StatusSource<VersionEvent>;
}
export type SourceName = keyof LiveAreaAdapters;
export type Freshness = Connection | "waiting" | "stale";
export const identityKey = (id: RunIdentity) => JSON.stringify([id.runId, id.branchId, id.buildId]);
export const activityKey = (event: ActivityEvent) => JSON.stringify([identityKey(event.identity), event.agentId]);
