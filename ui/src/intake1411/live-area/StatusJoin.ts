import { activityKey, identityKey } from "./contracts";
import type { ActivityEvent, BuildEvent, EventStamp, RunIdentity, VersionEvent } from "./contracts";

export type JoinedRecord<T> = Readonly<{ event: T; epoch: number }>;
export type JoinedRow = Readonly<{
  activity: JoinedRecord<ActivityEvent>;
  build?: JoinedRecord<BuildEvent>;
  version?: JoinedRecord<VersionEvent>;
}>;
export type JoinedReference = Readonly<{ identity: RunIdentity; build?: JoinedRecord<BuildEvent>; version?: JoinedRecord<VersionEvent> }>;

function validStamp(event: EventStamp) {
  const id = event?.identity;
  return id && [id.runId, id.branchId, id.buildId].every(value => typeof value === "string" && value.trim().length > 0)
    && Number.isSafeInteger(event.sequence) && event.sequence >= 0
    && Number.isFinite(event.observedAt) && event.observedAt >= 0 && event.observedAt <= 8.64e15;
}

/** One bounded ledger per source. Old values cannot overwrite a newer identity record. */
class RecordLedger<T extends EventStamp> {
  private records = new Map<string, JoinedRecord<T>>();
  constructor(private key: (event: T) => string) {}
  accept(event: T, epoch: number) {
    if (!validStamp(event)) return false;
    const key = this.key(event), old = this.records.get(key)?.event;
    if (old && (event.sequence <= old.sequence || event.observedAt < old.observedAt)) return false;
    // Copy at the boundary: later mutations of an adapter's object cannot change accepted data.
    this.records.set(key, { event: structuredClone(event), epoch });
    if (this.records.size > 200) this.records.delete(this.records.keys().next().value!);
    return true;
  }
  get(key: string) { return this.records.get(key); }
  values() { return [...this.records.values()]; }
}

/** Join only exact run + branch + build identities. Never infer identity from display labels. */
export class StatusJoin {
  private activity = new RecordLedger<ActivityEvent>(activityKey);
  private builds = new RecordLedger<BuildEvent>(event => identityKey(event.identity));
  private versions = new RecordLedger<VersionEvent>(event => identityKey(event.identity));
  acceptActivity(event: ActivityEvent, epoch: number) {
    return typeof event?.agentId === "string" && !!event.agentId.trim()
      && typeof event.agentName === "string" && !!event.agentName.trim() && typeof event.task === "string"
      && ["queued", "running", "waiting", "done", "failed", "stopped"].includes(event.state)
      && this.activity.accept(event, epoch);
  }
  acceptBuild(event: BuildEvent, epoch: number) {
    return typeof event?.label === "string" && ["building", "ready", "reloading", "failed"].includes(event.state)
      && this.builds.accept(event, epoch);
  }
  acceptVersion(event: VersionEvent, epoch: number) {
    return [event?.branchLabel, event?.worktreeLabel, event?.revision].every(value => typeof value === "string" && !!value.trim())
      && this.versions.accept(event, epoch);
  }
  rows(): readonly JoinedRow[] {
    return this.activity.values().map(activity => {
      const key = identityKey(activity.event.identity);
      return { activity, build: this.builds.get(key), version: this.versions.get(key) };
    });
  }
  references(): readonly JoinedReference[] {
    const identities = new Map([...this.builds.values(), ...this.versions.values()].map(record => [identityKey(record.event.identity), record.event.identity]));
    return [...identities].map(([key, identity]) => ({ identity, build: this.builds.get(key), version: this.versions.get(key) }));
  }
}
