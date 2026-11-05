import type { LiveAreaAdapters } from "./contracts";
import { ActivitySource } from "./ActivitySource";
import { SourceSubscription } from "./SourceSubscription";
import { StatusJoin } from "./StatusJoin";
import type { SourceStatus } from "./SourceSubscription";
import type { JoinedReference, JoinedRow } from "./StatusJoin";

export type LiveAreaSnapshot = Readonly<{
  enabled: boolean; rows: readonly JoinedRow[]; references: readonly JoinedReference[];
  sources: Readonly<{ activity: SourceStatus; build: SourceStatus; version: SourceStatus }>;
}>;
export const STALE_AFTER_MS = 30_000;

/** Composes source lifecycles and the identity join; does not persist or erase host data. */
export class LiveAreaStore {
  private join = new StatusJoin();
  private listeners = new Set<() => void>();
  private enabled = false;
  private timer?: ReturnType<typeof setInterval>;
  private activity: ActivitySource;
  private build: SourceSubscription<import("./contracts").BuildEvent>;
  private version: SourceSubscription<import("./contracts").VersionEvent>;
  private snapshot: LiveAreaSnapshot;
  constructor(adapters: LiveAreaAdapters, now = Date.now) {
    this.activity = new ActivitySource(adapters.activity, this.join, this.publish, now);
    this.build = new SourceSubscription(adapters.build, (event, epoch) => this.join.acceptBuild(event, epoch), this.publish, now);
    this.version = new SourceSubscription(adapters.version, (event, epoch) => this.join.acceptVersion(event, epoch), this.publish, now);
    this.snapshot = this.read();
  }
  private read(): LiveAreaSnapshot {
    return { enabled: this.enabled, rows: this.join.rows(), references: this.join.references(), sources: {
      activity: this.activity.status(STALE_AFTER_MS), build: this.build.status(STALE_AFTER_MS), version: this.version.status(STALE_AFTER_MS),
    } };
  }
  private publish = () => { this.snapshot = this.read(); for (const listener of this.listeners) listener(); };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.activity.start(); this.build.start(); this.version.start();
      this.timer = setInterval(this.publish, 1000);
    } else {
      this.activity.stop(); this.build.stop(); this.version.stop();
      clearInterval(this.timer); this.timer = undefined;
    }
    this.publish();
  }
  refresh = () => this.publish();
}
