import type { BuildEvent } from "./contracts";
import type { JoinedRecord } from "./StatusJoin";
import type { SourceStatus } from "./SourceSubscription";
import { FreshnessLabel } from "./FreshnessLabel";

export function BuildStatusSlot({ record, source }: { record?: JoinedRecord<BuildEvent>; source: SourceStatus }) {
  return <div className="la-slot"><h4>Build / reload</h4>{record ? <>
    <p>{record.event.state} · {record.event.label}</p><FreshnessLabel record={record} source={source} />
  </> : <p>Unavailable · no matching reload status</p>}</div>;
}
