import { useSyncExternalStore } from 'react';

export interface MapVisit { readonly branchId: string | null; readonly view: 'map' | 'detail' }
/** Host may retain this visit across mount/disable cycles. It stores no snapshot or user data. */
export function createMapSelection(initialBranchId: string | null = null) {
  let visit: MapVisit = { branchId: initialBranchId, view: 'map' };
  const listeners = new Set<() => void>();
  function publish(next: MapVisit) {
    visit = Object.freeze(next);
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => visit,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(branchId: string) { publish({ branchId, view: 'map' }); },
    inspect() { if (visit.branchId) publish({ ...visit, view: 'detail' }); },
    back() { publish({ ...visit, view: 'map' }); },
  };
}
export type MapSelection = ReturnType<typeof createMapSelection>;
export function useMapSelection(selection: MapSelection) {
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}
