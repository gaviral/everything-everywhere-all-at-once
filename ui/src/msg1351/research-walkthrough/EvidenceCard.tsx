import type { VerifiedEvidence } from "./contract";
import { EvidenceDetail } from "./EvidenceDetail";

export function EvidenceCard({ evidence }: { evidence: VerifiedEvidence }) {
  return <article>
    <p className="research-walkthrough-eyebrow">Research context · 1 of 1</p>
    <h3>{evidence.title}</h3>
    <p>{evidence.claim}</p>
    {evidence.asset && <figure><img src={evidence.asset.src} alt={evidence.asset.alt} /><figcaption>{evidence.asset.permission}</figcaption></figure>}
    <EvidenceDetail evidence={evidence} />
  </article>;
}
