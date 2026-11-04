import { identityKey } from "./contracts";
import type { RunIdentity } from "./contracts";
import type { LiveAreaSnapshot } from "./LiveAreaStore";
import { BuildStatusSlot } from "./BuildStatusSlot";
import { VersionStatusSlot } from "./VersionStatusSlot";

/** Keep the selected build visible even when its activity feed has not produced a row. */
export function SelectedStatus({ snapshot, selected }: { snapshot: LiveAreaSnapshot; selected?: RunIdentity }) {
  if (!selected || snapshot.rows.some(row => identityKey(row.activity.event.identity) === identityKey(selected))) return null;
  const reference = snapshot.references.find(record => identityKey(record.identity) === identityKey(selected));
  return <section className="la-row la-selected" aria-label="Selected build status">
    <h3>Selected build</h3><p className="la-identity">Run {selected.runId} · Git branch {selected.branchId} · Build {selected.buildId}</p>
    <div className="la-slots"><div className="la-slot"><h4>Activity</h4><p>Unavailable · no matching agent activity</p></div>
      <BuildStatusSlot record={reference?.build} source={snapshot.sources.build} />
      <VersionStatusSlot record={reference?.version} source={snapshot.sources.version} /></div>
  </section>;
}
