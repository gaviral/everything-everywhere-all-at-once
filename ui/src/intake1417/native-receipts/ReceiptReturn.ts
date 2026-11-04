import { ReceiptInput, type ReceiptAdapter, type ReceiptOperation } from "./ReceiptInput";

export interface ReceiptVisit {
  readonly enabled: boolean;
  readonly operations: readonly ReceiptOperation[];
  readonly selectedId: string | null;
  readonly detail: boolean;
  readonly notice: string;
}

function initialOperations(values: readonly unknown[]): readonly ReceiptOperation[] {
  const operations = values.map(ReceiptInput);
  if (operations.some(value => !value)) throw new Error("Invalid receipt input.");
  const valid = operations as ReceiptOperation[];
  if (new Set(valid.map(value => value.operationId)).size !== valid.length) throw new Error("Operation identities must be unique.");
  return Object.freeze(valid);
}

/** One visit belongs to the host, outliving detail navigation and component mounts. */
export function createReceiptVisit(values: readonly unknown[] = [], adapter?: ReceiptAdapter) {
  const operations = initialOperations(values);
  let snapshot: ReceiptVisit = Object.freeze({ enabled: false, operations, selectedId: operations[0]?.operationId ?? null,
    detail: false, notice: "" });
  const listeners = new Set<() => void>();
  let cleanup: (() => void) | undefined;
  let generation = 0;
  const update = (patch: Partial<ReceiptVisit>) => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  };
  const receive = (value: unknown) => {
    const operation = ReceiptInput(value);
    if (!operation) { update({ notice: "An invalid result was withheld." }); return; }
    const previous = snapshot.operations.find(row => row.operationId === operation.operationId);
    if (previous && (previous.provider !== operation.provider || previous.origin !== operation.origin ||
        JSON.stringify(previous.reminder) !== JSON.stringify(operation.reminder))) {
      update({ notice: "A result with conflicting operation identity was withheld." }); return;
    }
    const next = previous ? snapshot.operations.map(row => row.operationId === operation.operationId ? operation : row)
      : [...snapshot.operations, operation];
    update({ operations: Object.freeze(next), selectedId: snapshot.selectedId ?? operation.operationId, notice: "" });
  };
  const stop = () => {
    generation++;
    const ownedCleanup = cleanup;
    cleanup = undefined;
    try { ownedCleanup?.(); } catch { update({ notice: "The result observer could not close cleanly." }); }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled(enabled: boolean) {
      if (snapshot.enabled === enabled) return;
      if (!enabled) { update({ enabled }); stop(); return; }
      update({ enabled, notice: "" });
      if (!adapter) return;
      const current = ++generation;
      try {
        const release = adapter.subscribe(value => {
          if (snapshot.enabled && generation === current) receive(value);
        });
        if (typeof release !== "function") throw new Error("Missing observer cleanup.");
        if (snapshot.enabled && generation === current) cleanup = release;
        else release();
      } catch { generation++; update({ notice: "Result observer unavailable. Completion remains unconfirmed." }); }
    },
    select(operationId: string) {
      if (snapshot.operations.some(row => row.operationId === operationId)) update({ selectedId: operationId, detail: false });
    },
    showDetail() { if (snapshot.selectedId) update({ detail: true }); },
    returnToPreview() { update({ detail: false }); },
    /** Host calls this only when discarding the visit, not on a detail return. */
    dispose() { update({ enabled: false }); stop(); listeners.clear(); },
  };
}
export type ReceiptReturn = ReturnType<typeof createReceiptVisit>;
