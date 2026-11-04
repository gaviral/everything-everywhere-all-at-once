import type { MergeAdapter, MergeState, VariantReference, VariantState } from "./contracts";
import { preserveReferences } from "./reference";
import { sendMergeRequest } from "./merge-request";

/** Host-owned session: retain this instance across view visits. No storage or branch management. */
export function createVariantSession(input: readonly VariantReference[], mergeAdapter?: MergeAdapter) {
  const references = preserveReferences(input);
  let state: VariantState = Object.freeze({ enabled: false, selectedId: null, activeId: null,
    comparison: Object.freeze({ leftId: references[0]?.id ?? null, rightId: references[1]?.id ?? null }),
    merge: Object.freeze({ status: "idle" as const }) });
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<VariantState>) => {
    const next = { ...state, ...patch };
    state = Object.freeze({ ...next, activeId: next.enabled ? next.selectedId : null });
    listeners.forEach(listener => listener());
  };
  const updateMerge = (merge: MergeState) => publish({ merge: Object.freeze(merge) });
  const requestMerge = async () => {
    if (!mergeAdapter || !state.activeId || state.merge.status === "pending" || state.merge.status === "error") return;
    const variant = references.find(reference => reference.id === state.activeId)!;
    const request = Object.freeze({ requestId: crypto.randomUUID(), variant });
    await sendMergeRequest(mergeAdapter, request, updateMerge);
  };
  return Object.freeze({
    references,
    mergeAvailable: Boolean(mergeAdapter),
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled(enabled: boolean) { publish({ enabled }); },
    compare(side: "leftId" | "rightId", id: string) {
      if (!references.some(reference => reference.id === id)) throw new Error("Unknown comparison choice.");
      const other = side === "leftId" ? "rightId" : "leftId";
      if (state.comparison[other] === id) throw new Error("Choose different alternatives to compare.");
      publish({ comparison: Object.freeze({ ...state.comparison, [side]: id }) });
    },
    select(id: string) {
      if (!references.some(reference => reference.id === id)) throw new Error("Unknown choice.");
      publish({ selectedId: id });
    },
    disableSelection() { publish({ selectedId: null }); },
    requestMerge,
  });
}

export type VariantSession = ReturnType<typeof createVariantSession>;
