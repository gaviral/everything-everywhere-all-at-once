import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ReceiptReturn } from "./ReceiptReturn";
import { createReceiptVisit } from "./ReceiptReturn";
import { ReminderPreview } from "./ReminderPreview";
import { EvidenceDetail } from "./EvidenceDetail";
import "./native-receipts.css";

export { createReceiptVisit, ReceiptInput, ReceiptState } from "./public";
export type { ReceiptAdapter, ReceiptOperation, ExternalReceipt, ReminderFields } from "./ReceiptInput";
export type { ReceiptReturn, ReceiptVisit } from "./ReceiptReturn";

function OperationChoice({ visit }: { visit: ReceiptReturn }) {
  const state = useSyncExternalStore(visit.subscribe, visit.getSnapshot, visit.getSnapshot);
  return <label className="native-receipts-choice">Operation
    <select value={state.selectedId ?? ""} onChange={event => visit.select(event.target.value)} disabled={!state.operations.length}>
      {!state.operations.length && <option value="">No operations supplied</option>}
      {state.operations.map(operation => <option key={operation.operationId} value={operation.operationId}>
        {operation.origin === "synthetic" ? "Sample · " : ""}{operation.operationId} · {operation.reminder.title}
      </option>)}
    </select>
  </label>;
}

function ResultVisit({ visit }: { visit: ReceiptReturn }) {
  const state = useSyncExternalStore(visit.subscribe, visit.getSnapshot, visit.getSnapshot);
  const operation = state.operations.find(row => row.operationId === state.selectedId);
  const detailButton = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const priorDetail = useRef(state.detail);
  useLayoutEffect(() => {
    if (priorDetail.current !== state.detail) (state.detail ? returnButton : detailButton).current?.focus();
    priorDetail.current = state.detail;
  }, [state.detail]);
  if (!operation) return <p>No receipt result supplied. Completion is unknown.</p>;
  return state.detail ? <>
    <EvidenceDetail operation={operation} />
    <button ref={returnButton} onClick={visit.returnToPreview}>Return to result</button>
  </> : <>
    <ReminderPreview operation={operation} />
    <button ref={detailButton} onClick={visit.showDetail}>View receipt evidence</button>
  </>;
}

/** Host retains visit across navigation and disposes it only when the feature is discarded. */
export function NativeReceipts({ visit }: { visit: ReceiptReturn }) {
  const state = useSyncExternalStore(visit.subscribe, visit.getSnapshot, visit.getSnapshot);
  return <section className="native-receipts" aria-label="Native receipt results">
    <header><p className="native-receipts-eyebrow">Reminders</p><h1>Result receipt</h1>
      <p>Review the requested reminder and the evidence for its result.</p></header>
    <label className="native-receipts-switch"><input type="checkbox" checked={state.enabled}
      onChange={event => visit.setEnabled(event.target.checked)} />Observe receipt results</label>
    <p>{state.enabled ? "Receipt view on. Only supplied results are observed." : "Receipt view off. Saved selection and preview retained; result observation is stopped."}</p>
    {state.notice && <p role="alert">{state.notice}</p>}
    <OperationChoice visit={visit} />
    <ResultVisit visit={visit} />
  </section>;
}

export const nativeReceiptsFeature = Object.freeze({
  id: "intake1417-native-receipts",
  label: "Reminders result receipts",
  defaultEnabled: false,
  createVisit: createReceiptVisit,
  Component: NativeReceipts,
});
