import type { VersionSnapshot } from './contract';

export function syntheticSnapshot(): VersionSnapshot {
  return {
    schemaVersion: 1, revision: 'sample-1', observedAt: '2026-01-01T12:00:00Z', freshness: 'current',
    main: { id: 'main', name: 'main', revision: 'main-r10' },
    branches: [
      { id: 'branch-orchard', name: 'orchard-layout', parentId: 'main', head: 'orchard-r12',
        lane: { id: 'lane-orchard', label: 'Orchard lane' }, worktree: { id: 'worktree-orchard', label: 'Orchard workspace' },
        build: { id: 'orchard-build-7', revision: 'orchard-r11' } },
      { id: 'branch-river', name: 'river-notes', parentId: 'branch-orchard', head: 'river-r5',
        lane: { id: 'lane-river', label: 'River lane' }, worktree: { id: 'worktree-river', label: 'River workspace' },
        build: { id: 'river-build-3', revision: 'river-r5' } },
    ],
  };
}
