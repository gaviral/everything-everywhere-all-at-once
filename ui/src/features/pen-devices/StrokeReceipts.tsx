import type { SessionDestination } from "./contracts";
import type { DeliveryRecord } from "./StrokeDelivery";

export function StrokeReceipts({ records, sessions }: { records: readonly DeliveryRecord[]; sessions: readonly SessionDestination[] }) {
  return <><h3>Stroke receipts</h3>
    {records.length === 0 ? <p>No strokes sent.</p> : <ol className="pen-receipts">{records.map(record => <li key={record.stroke.id}
      data-delivery={record.state} data-stroke-id={record.stroke.id}>
      <strong>{sessions.find(session => session.id === record.stroke.sessionId)?.name ?? "Closed session"}</strong>
      <span>{record.message}</span><code>{record.stroke.id}</code>
      <small>{record.stroke.points.length} original samples · {record.stroke.device}</small>
    </li>)}</ol>}
  </>;
}
