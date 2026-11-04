import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorktreeMap, createMapSelection, worktreeMapFeature, type WorktreeMapAdapter } from './index';
import { syntheticSnapshot } from './syntheticSnapshot';
import { validateVersionSnapshot } from './VersionSnapshot';
import { branchRelationships } from './branchRelationships';
import './preview.css';

function createSyntheticOwner() {
  let snapshot: unknown = syntheticSnapshot(), reads = 0;
  const listeners = new Set<() => void>();
  const adapter: WorktreeMapAdapter = {
    getSnapshot() { reads++; return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { adapter,
    publish(value: unknown) { snapshot = value; listeners.forEach(listener => listener()); },
    stats: () => ({ reads, subscriptions: listeners.size }),
  };
}
const owner = createSyntheticOwner();
const selection = createMapSelection();

function updatedSnapshot() {
  const original = syntheticSnapshot();
  return { ...original, revision: 'sample-2', freshness: 'stale' as const, branches: original.branches.map(branch => branch.id === 'branch-orchard'
    ? { ...branch, build: { id: 'orchard-build-8', revision: 'orchard-r12' } } : branch).reverse() };
}
function unknownSnapshot() {
  const original = syntheticSnapshot();
  return { ...original, revision: 'sample-unknown', branches: original.branches.map(branch => ({ ...branch, parentId: null, build: null })) };
}
function Preview() {
  const [enabled, setEnabled] = useState(false);
  return <main className="wm-preview">
    <header><p>Synthetic preview · owner adapter fixture</p><h1>Follow a lane to its build</h1><p>Display identities only. No git service or branch actions.</p></header>
    <section className="wm-preview-controls" aria-label="Synthetic snapshot controls">
      <button onClick={() => owner.publish(updatedSnapshot())}>Publish updated snapshot</button>
      <button onClick={() => owner.publish(unknownSnapshot())}>Publish unknown data</button>
      <button onClick={() => owner.publish({ schemaVersion: 0 })}>Publish invalid snapshot</button>
      <button onClick={() => owner.publish({ ...syntheticSnapshot(), branches: [] })}>Remove Git branches</button>
      <button onClick={() => owner.publish(syntheticSnapshot())}>Restore sample</button>
    </section>
    <WorktreeMap enabled={enabled || undefined} adapter={owner.adapter} selection={selection} onRequestClose={() => setEnabled(false)}
      hostView={<section className="wm-preview-host" aria-label="Host view"><h2>Code canvas host</h2><p>The worktree map is off.</p><button onClick={() => setEnabled(true)}>Open worktree map</button></section>} />
  </main>;
}

// Fixture-only diagnostics; these are never imported by the feature entry point.
Object.assign(window, { worktreeMapPreview: { stats: owner.stats, validateVersionSnapshot, branchRelationships, syntheticSnapshot, descriptor: worktreeMapFeature } });
createRoot(document.getElementById('root')!).render(<Preview />);
