import { useState, type ReactNode } from 'react';
import type { WorktreeMapAdapter } from './contract';
import { createMapSelection, useMapSelection, type MapSelection } from './MapSelection';
import { useVersionSnapshot } from './useVersionSnapshot';
import { BranchTree } from './BranchTree';
import { LaneIdentity } from './LaneIdentity';
import './worktree-map.css';

export interface WorktreeMapProps {
  enabled?: boolean;
  adapter: WorktreeMapAdapter;
  hostView: ReactNode;
  selection?: MapSelection;
  onRequestClose: () => void;
}

function ActiveMap({ adapter, selection, onRequestClose }: Pick<WorktreeMapProps, 'adapter' | 'onRequestClose'> & { selection: MapSelection }) {
  const { snapshot, error } = useVersionSnapshot(adapter);
  const visit = useMapSelection(selection);
  return <section className="wm" aria-label="Worktree map">
    <header className="wm-header"><div><p>Version relationships · Read only</p><h2>Worktree map</h2></div><button onClick={onRequestClose}>Return to host</button></header>
    {!snapshot ? <p role="status">{error}</p> : <>
      <p className="wm-status" role="status">{snapshot.freshness === 'stale' ? 'Stale snapshot' : 'Owner snapshot'} · {snapshot.revision} · Observed {snapshot.observedAt}</p>
      {visit.view === 'detail' ? <LaneIdentity branch={snapshot.branches.find(branch => branch.id === visit.branchId)} snapshot={snapshot} detail onInspect={selection.inspect} onBack={selection.back} /> :
        <div className="wm-layout"><BranchTree snapshot={snapshot} visit={visit} selection={selection} />
          {visit.branchId ? <LaneIdentity branch={snapshot.branches.find(branch => branch.id === visit.branchId)} snapshot={snapshot} onInspect={selection.inspect} onBack={selection.back} /> :
            <section className="wm-identity"><h3>Select a Git branch</h3><p>See the lane, worktree and build supplied by its owner.</p></section>}
        </div>}
    </>}
  </section>;
}

/** Disabled boundary never mounts the snapshot reader or its subscription. */
export function WorktreeMap({ enabled = false, hostView, selection: suppliedSelection, ...props }: WorktreeMapProps) {
  const [localSelection] = useState(createMapSelection);
  return enabled ? <ActiveMap {...props} selection={suppliedSelection ?? localSelection} /> : <>{hostView}</>;
}
