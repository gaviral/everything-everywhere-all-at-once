import type { VerifiedEvidence } from "./contract";

export function EvidenceDetail({ evidence }: { evidence: VerifiedEvidence }) {
  return <details className="research-walkthrough-detail">
    <summary>Source and limits</summary>
    <p><a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{evidence.sourceTitle} (opens a new tab)</a></p>
    <p>{evidence.citation} · Source checked {evidence.verifiedOn}</p>
    <p>{evidence.support}</p>
    <p><strong>Limit:</strong> {evidence.limitation}</p>
  </details>;
}
