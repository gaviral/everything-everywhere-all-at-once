import type { ReceiptOperation } from "./ReceiptInput";
import { ReceiptState } from "./ReceiptState";

export function EvidenceDetail({ operation }: { operation: ReceiptOperation }) {
  const state = ReceiptState(operation);
  return <article className="native-receipts-result" aria-label="Receipt evidence">
    <h2>Receipt evidence</h2>
    <dl>
      <dt>Operation</dt><dd>{operation.operationId}</dd>
      <dt>Provider</dt><dd>Apple Reminders</dd>
      <dt>Source</dt><dd>{operation.origin === "synthetic" ? "Injected synthetic sample" : "Supplied native adapter result"}</dd>
      <dt>Result</dt><dd>{state.label}</dd>
      <dt>Matching receipt</dt><dd>{state.hasMatchingReceipt ? "Supplied for this operation and provider" : "Unavailable"}</dd>
      {state.hasMatchingReceipt && <><dt>Observed</dt><dd>{operation.receipt!.observedAt}</dd></>}
    </dl>
    <p>{state.message}</p>
    <p className="native-receipts-limit">Receipt references and raw adapter diagnostics are withheld. This view cannot independently inspect an account or verify its current contents.</p>
  </article>;
}
