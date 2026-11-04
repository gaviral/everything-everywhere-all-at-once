import { useState } from 'react';
import type { Command, Revision } from './model';

export function CompletionEvidence({ revision, actor, human, send }: { revision: Revision; actor: string; human: boolean; send: (command: Command) => void }) {
  const [effect, describe] = useState('');
  const [evidence, cite] = useState('');
  const [confirmed, confirm] = useState(false);
  return <section className="revision-review-step revision-review-evidence" aria-label="Completion evidence">
    <p className="revision-review-eyebrow">03 · Resulting effect</p><h2>Show what changed.</h2>
    {revision.receipt ? <div className="revision-review-receipt"><strong>Completed · human verified · r{revision.number}</strong>
      <h3>Observed effect</h3><p>{revision.receipt.effect}</p><h3>Evidence checked</h3><p>{revision.receipt.evidence}</p>
      <small>Verified by {revision.receipt.actor} · {new Date(revision.receipt.at).toLocaleString()}</small></div>
      : revision.decision?.kind !== 'approved' ? <p>Approve this revision before recording completion. Comments and review alone leave this step open.</p>
      : <form onSubmit={event => { event.preventDefault(); send({ kind: 'complete', confirmed: confirmed && human, receipt: { effect: effect.trim(), evidence: evidence.trim(), actor, at: Date.now() } }); }}>
        <label>Observed effect<textarea value={effect} onChange={event => describe(event.target.value)} maxLength={4000} required placeholder="What actually happened after this revision was used?" /></label>
        <label>Evidence you checked<textarea value={evidence} onChange={event => cite(event.target.value)} maxLength={4000} required placeholder="A receipt, result URL, or concrete observation someone can check." /></label>
        <label className="revision-review-check"><input type="checkbox" checked={confirmed} onChange={event => confirm(event.target.checked)} disabled={!human} />I checked this evidence and verified the effect of revision {revision.number}.</label>
        <button type="submit" disabled={!human || !confirmed || !effect.trim() || !evidence.trim()}>Record verified completion</button>
      </form>}
    <p className="revision-review-hint">A human attestation kept here. This workspace does not run the work or independently verify an external service.</p>
  </section>;
}
