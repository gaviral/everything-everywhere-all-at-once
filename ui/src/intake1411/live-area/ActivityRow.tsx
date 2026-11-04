import { identityKey } from "./contracts";
import type { RunIdentity } from "./contracts";
import type { JoinedRow } from "./StatusJoin";
import type { LiveAreaSnapshot } from "./LiveAreaStore";
import { FreshnessLabel } from "./FreshnessLabel";
import { BuildStatusSlot } from "./BuildStatusSlot";
import { VersionStatusSlot } from "./VersionStatusSlot";

export function ActivityRow({ row, sources, selected }: { row: JoinedRow; sources: LiveAreaSnapshot["sources"]; selected?: RunIdentity }) {
  const activity = row.activity.event, identity = activity.identity;
  const isSelected = selected && identityKey(selected) === identityKey(identity);
  return <li className="la-row" data-agent={activity.agentId} data-branch={identity.branchId}>
    <div className="la-row-heading"><h3>{activity.agentName}</h3><span>{isSelected ? "Selected build" : "Observed build"}</span></div>
    <p className="la-identity">Run {identity.runId} · Branch {identity.branchId} · Build {identity.buildId}</p>
    <div className="la-slots"><div className="la-slot"><h4>Activity</h4><p>{activity.state} · {activity.task}</p>
      <FreshnessLabel record={row.activity} source={sources.activity} />
      <time dateTime={new Date(activity.observedAt).toISOString()}>Reported {new Date(activity.observedAt).toLocaleTimeString()}</time>
    </div><BuildStatusSlot record={row.build} source={sources.build} /><VersionStatusSlot record={row.version} source={sources.version} /></div>
  </li>;
}
