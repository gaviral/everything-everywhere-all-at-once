import { useState } from 'react';
import type { Command, Revision } from './model';

export function ReviewDecision({ revision, actor, human, send }: { revision: Revision; actor: string; human: boolean; send: (command: Command) => void }) {
  const [confirmed, confirm] = useState(false);
  const [reason, explain] = useState('');
  return <section className="revision-review-step" aria-label="Human revision review">
    <p className="revision-review-eyebrow">02 · Human decision</p><h2>Review these words.</h2>
    {!revision.ready ? <><p>Finish the draft, then invite a decision on this exact revision.</p><button type="button" onClick={() => send({ kind: 'ready' })}>Mark ready for review</button></>
      : revision.decision ? <><p className="revision-review-verdict">{revision.decision.kind === 'approved' ? 'Approved' : 'Changes requested'} · r{revision.number}</p>
        <p>{revision.decision.actor} · {new Date(revision.decision.at).toLocaleString()}</p>{revision.decision.reason && <p>{revision.decision.reason}</p>}
        <p>{revision.decision.kind === 'approved' ? 'Approval covers these words. The resulting effect still needs evidence.' : 'Save a new revision to respond. This decision stays with these words.'}</p></>
      : <form onSubmit={event => { event.preventDefault(); send({ kind: 'decide', confirmed: confirmed && human, decision: { kind: 'approved', actor, at: Date.now(), reason: reason.trim() } }); }}>
        <p>Ready for review · r{revision.number}. Reading or acknowledging this page records no approval.</p>
        <label>Review note<textarea value={reason} onChange={event => explain(event.target.value)} maxLength={4000} placeholder="What should change, or why is this ready?" /></label>
        <label className="revision-review-check"><input type="checkbox" checked={confirmed} onChange={event => confirm(event.target.checked)} disabled={!human} />I reviewed revision {revision.number} and approve these exact words.</label>
        <div className="revision-review-buttons"><button type="submit" disabled={!confirmed || !human}>Approve revision {revision.number}</button>
          <button type="button" disabled={!reason.trim() || !human} onClick={() => send({ kind: 'decide', confirmed: human, decision: { kind: 'changes', actor, at: Date.now(), reason: reason.trim() } })}>Request changes</button></div>
      </form>}
    {!human && <p>A human participant must make the review and verification decisions.</p>}
  </section>;
}
