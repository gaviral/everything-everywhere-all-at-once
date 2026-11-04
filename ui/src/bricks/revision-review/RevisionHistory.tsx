import { status, type Artifact } from './model';

export function RevisionHistory({ artifact }: { artifact: Artifact }) {
  const previous = artifact.revisions.slice(0, -1).reverse();
  if (!previous.length) return null;
  return <section className="revision-review-history" aria-label="Earlier revisions"><h2>Earlier words, decisions kept.</h2>
    <p>Earlier approval and completion never apply to the current revision.</p>
    {previous.map(revision => <details key={revision.number}><summary>Revision {revision.number} · {status(revision)}</summary>
      <h3>{revision.title}</h3><p className="revision-review-words">{revision.body}</p>
      {revision.decision && <p>{revision.decision.kind === 'approved' ? 'Approved' : 'Changes requested'} by {revision.decision.actor} · {revision.decision.reason}</p>}
      {artifact.comments.filter(comment => comment.revision === revision.number).map(comment => <blockquote key={comment.id}>{comment.quote}<p>{comment.text} · {comment.actor}</p></blockquote>)}
      {revision.receipt && <div><h3>Verified effect · r{revision.number}</h3><p>{revision.receipt.effect}</p><p>Evidence: {revision.receipt.evidence}</p><p>Verified by {revision.receipt.actor}</p></div>}
    </details>)}
  </section>;
}
