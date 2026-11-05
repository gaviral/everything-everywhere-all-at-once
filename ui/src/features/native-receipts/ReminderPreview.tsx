import type { ReceiptOperation } from "./ReceiptInput";
import { ReceiptState } from "./ReceiptState";

export function ReminderPreview({ operation }: { operation: ReceiptOperation }) {
  const state = ReceiptState(operation);
  return <article className="native-receipts-result" aria-label="Selected reminder result">
    <p className="native-receipts-eyebrow">{operation.origin === "synthetic" ? "Sample reminder · App preview" : "Reminders result · App view"}</p>
    <h2>{operation.reminder.title}</h2>
    <p role="status" className={`native-receipts-status native-receipts-${state.outcome}`}>{state.label}</p>
    <p>{state.message}</p>
    <dl>
      <dt>Operation</dt><dd>{operation.operationId}</dd>
      <dt>List</dt><dd>{operation.reminder.list}</dd>
      <dt>Due</dt><dd>{operation.reminder.due || "No due date requested"}</dd>
      <dt>Notes</dt><dd>{operation.reminder.notes || "No notes requested"}</dd>
    </dl>
    {operation.origin === "synthetic" && <p className="native-receipts-limit">Synthetic data. This is our app’s preview, not Apple Reminders UI. No external action is performed.</p>}
  </article>;
}
