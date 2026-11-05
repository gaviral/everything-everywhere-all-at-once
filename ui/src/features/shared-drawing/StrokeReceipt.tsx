import type { DrawingSnapshot } from './contract';

export function StrokeReceipt({ snapshot, enabled }: { snapshot: DrawingSnapshot; enabled: boolean }) {
  const accepted = snapshot.entries.filter(entry => entry.acknowledged).length;
  const pending = snapshot.entries.length - accepted;
  return <section className="sd-receipt" aria-label="Stroke receipts">
    <p role="status">{!enabled ? 'Shared drawing is off. Your drawing is kept.' : !snapshot.exchangeId ? 'Choose a destination session to begin.' :
      `${snapshot.connected ? 'Connected' : 'Disconnected'} · ${accepted} acknowledged · ${pending} pending`}</p>
    <details><summary>Stroke IDs and original history ({snapshot.entries.length})</summary>
      <ol>{snapshot.entries.map(({ operation, acknowledged }) => <li key={operation.id} data-operation-id={operation.id}>
        <span>{operation.kind === 'undo' ? 'Undo' : operation.replaces ? 'Correction' : 'Original stroke'}</span>{' '}
        <code>{operation.id}</code> — <strong>{acknowledged ? 'Acknowledged' : 'Pending'}</strong>
        {operation.kind === 'stroke' && <span> · {operation.points.length} points preserved</span>}
      </li>)}</ol>
    </details>
  </section>;
}
