import { useEffect, useRef } from 'react';
import type { VersionBranch, VersionSnapshot } from './contract';
import { branchRelationships } from './branchRelationships';

function IdentityFields({ branch, snapshot }: { branch: VersionBranch; snapshot: VersionSnapshot }) {
  const known = !branchRelationships(snapshot).find(row => row.branch.id === branch.id)?.unknownBase;
  const parent = branch.parentId === snapshot.main.id ? snapshot.main.name : snapshot.branches.find(item => item.id === branch.parentId)?.name;
  return <dl className="wm-fields">
    <dt>Lane</dt><dd>{branch.lane?.label ?? 'Unknown'}</dd>
    <dt>Worktree</dt><dd>{branch.worktree?.label ?? 'Unknown'}</dd>
    <dt>Worktree identity</dt><dd><code>{branch.worktree?.id ?? 'Unknown'}</code></dd>
    <dt>Branch revision</dt><dd><code>{branch.head ?? 'Unknown'}</code></dd>
    <dt>Build</dt><dd>{branch.build?.id ?? 'Unknown'}</dd>
    <dt>Build revision</dt><dd><code>{branch.build?.revision ?? 'Unknown'}</code></dd>
    <dt>Base</dt><dd>{known ? parent : 'Unknown'}</dd>
  </dl>;
}

export function LaneIdentity({ branch, snapshot, detail = false, onInspect, onBack }: {
  branch: VersionBranch | undefined; snapshot: VersionSnapshot; detail?: boolean; onInspect: () => void; onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (detail) heading.current?.focus(); }, [detail]);
  return <section className="wm-identity" aria-label={detail ? 'Branch detail' : 'Selected branch'}>
    {detail && <button onClick={onBack}>Back to map</button>}
    <h3 ref={heading} tabIndex={-1}>{branch?.name ?? 'Selected branch unavailable'}</h3>
    {branch ? <>
      <IdentityFields branch={branch} snapshot={snapshot} />
      {!detail && <button className="wm-primary" onClick={onInspect}>Inspect branch</button>}
    </> : <p>The selected identity is absent from this snapshot. Your selection is retained; choose another branch or wait for an update.</p>}
  </section>;
}
