import type { EventStamp } from "./contracts";
import type { JoinedRecord } from "./StatusJoin";
import type { SourceStatus } from "./SourceSubscription";
import { STALE_AFTER_MS } from "./LiveAreaStore";

export function recordFreshness(record: JoinedRecord<EventStamp>, source: SourceStatus, now: number) {
  if (source.state === "unavailable") return "Unavailable · last known";
  if (source.state === "disconnected") return "Disconnected · last known";
  if (record.epoch !== source.epoch) return "Stale identity · awaiting current record";
  if (source.state !== "connected" || now - record.event.observedAt >= STALE_AFTER_MS) return "Stale · last known";
  return "Current";
}
export function FreshnessLabel({ record, source }: { record: JoinedRecord<EventStamp>; source: SourceStatus }) {
  const label = recordFreshness(record, source, Date.now());
  return <span className="la-freshness" data-freshness={label === "Current" ? "current" : "stale"}>{label}</span>;
}
