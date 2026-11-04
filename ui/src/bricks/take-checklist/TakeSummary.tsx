export function TakeSummary({ count, total, take, onReset, onClose }: {
  count: number; total: number; take: number; onReset: () => void; onClose: () => void;
}) {
  return <div className="take-checklist-heading">
    <div className="take-checklist-heading-copy">
      <div className="take-checklist-eyebrow">PRE-DEMO · TAKE {String(take).padStart(2, "0")}</div>
      <h1 className="take-checklist-title">Before the take.</h1>
      <p className="take-checklist-subtitle">One quiet moment. Everything in place.</p>
      <div className="take-checklist-controls">
        <button type="button" onClick={onReset}>New take</button>
        <button type="button" onClick={onClose}>Back to map <span aria-hidden="true">↗</span></button>
      </div>
    </div>
    <div className="take-checklist-progress" role="status" aria-live="polite" aria-atomic="true" data-complete={count === total}>
      <span className="take-checklist-count">{count}<span>/{total}</span></span>
      <strong>{count === total ? "Checks complete" : "Getting ready"}</strong>
      <span>{count === total ? "Your call to start." : `${total - count} left to check`}</span>
    </div>
  </div>;
}
