import { useEffect, useState } from 'react';
import type { VersionSnapshot, WorktreeMapAdapter } from './contract';
import { validateVersionSnapshot } from './VersionSnapshot';

type SnapshotState = { snapshot: VersionSnapshot; error: null } | { snapshot: null; error: string };
const unavailable: SnapshotState = { snapshot: null, error: 'Snapshot unavailable. The owner has not supplied a valid version snapshot.' };
function readSnapshot(adapter: WorktreeMapAdapter): SnapshotState {
  try { return { snapshot: validateVersionSnapshot(adapter.getSnapshot()), error: null }; }
  catch { return unavailable; }
}

export function useVersionSnapshot(adapter: WorktreeMapAdapter): SnapshotState {
  const [state, setState] = useState<SnapshotState>(unavailable);
  useEffect(() => {
    let active = true;
    const update = () => { if (active) setState(readSnapshot(adapter)); };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = adapter.subscribe(update);
      update(); // Read after subscribing so an arriving update cannot be lost.
    } catch { setState(unavailable); }
    return () => { active = false; unsubscribe?.(); };
  }, [adapter]);
  return state;
}
