import { useEffect, useRef } from 'react';
import type { VersionSnapshot } from './contract';
import type { MapSelection, MapVisit } from './MapSelection';
import { branchRelationships } from './branchRelationships';

export function BranchTree({ snapshot, visit, selection }: { snapshot: VersionSnapshot; visit: MapVisit; selection: MapSelection }) {
  const selectedButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedButton.current?.focus(); }, []);
  return <section aria-label="Git branch relationships">
    <div className="wm-root"><span>Supplied main</span><strong>{snapshot.main.name}</strong><code>{snapshot.main.revision}</code></div>
    <ul className="wm-branches">
      {branchRelationships(snapshot).map(({ branch, depth, unknownBase }) => <li key={branch.id} style={{ paddingInlineStart: `${Math.min(depth, 5) * 12}px` }}>
        <button ref={visit.branchId === branch.id ? selectedButton : undefined} aria-pressed={visit.branchId === branch.id}
          onClick={() => selection.select(branch.id)}>
          <span className="wm-branch-title">{branch.name}{visit.branchId === branch.id && <span className="wm-selected">Selected</span>}</span>
          <span>{unknownBase ? 'Base: Unknown' : `From ${branch.parentId === snapshot.main.id ? snapshot.main.name : snapshot.branches.find(parent => parent.id === branch.parentId)?.name}`}</span>
          <span>Lane: {branch.lane?.label ?? 'Unknown'}</span>
        </button>
      </li>)}
    </ul>
    {!snapshot.branches.length && <p>No Git branches in this snapshot.</p>}
  </section>;
}
