import type { VersionEvent } from "./contracts";
import type { JoinedRecord } from "./StatusJoin";
import type { SourceStatus } from "./SourceSubscription";
import { FreshnessLabel } from "./FreshnessLabel";

export function VersionStatusSlot({ record, source }: { record?: JoinedRecord<VersionEvent>; source: SourceStatus }) {
  return <div className="la-slot"><h4>Version / worktree</h4>{record ? <>
    <p>{record.event.branchLabel} · {record.event.worktreeLabel}</p><p>Revision {record.event.revision}</p>
    <FreshnessLabel record={record} source={source} />
  </> : <p>Unavailable · no matching version reference</p>}</div>;
}
