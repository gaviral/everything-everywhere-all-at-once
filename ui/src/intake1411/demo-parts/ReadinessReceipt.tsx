import type { CandidateDescriptor, CandidateSnapshot, EvidenceLink } from './contracts'
import { candidateReadiness, safeEvidenceHref } from './readiness'
import type { ResolvedProof } from './readiness'

export function EvidenceReference({ link }: { link?: EvidenceLink }) {
  const href = safeEvidenceHref(link)
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{link!.label}</a> : <span>Evidence link unavailable</span>
}

function ProofReceipt({ proof }: { proof: ResolvedProof }) {
  return <li className="dp-proof">
    <div><strong>{proof.requirement.label}</strong><span className={`dp-state dp-${proof.state}`}>{proof.state}</span></div>
    <p>{proof.reason}</p>
    {proof.requirement.reference && <p>Requirement: <EvidenceReference link={proof.requirement.reference} /></p>}
    {proof.receipt && <>
      <p>{proof.receipt.summary}</p>
      <p>{proof.receipt.scope === 'synthetic' ? 'Synthetic receipt' : 'Live receipt'} · <EvidenceReference link={proof.receipt.source} /></p>
      <p>Observed: {proof.receipt.observedAt ?? 'Not supplied'}<br />Valid until: {proof.receipt.freshUntil ?? 'Not supplied'}</p>
      <p>Build: {proof.receipt.buildId ?? 'Not supplied'} · Device: {proof.receipt.deviceId ?? 'Not supplied'}</p>
    </>}
  </li>
}

export function ReadinessStatus({ candidate, snapshot, now }: { candidate: CandidateDescriptor; snapshot: CandidateSnapshot; now: number }) {
  const { available } = candidateReadiness(candidate, snapshot, now)
  return <p className="dp-readiness">{available ? 'Live demonstration available' : 'Live demonstration unavailable'}</p>
}

export function ReadinessReceipt({ candidate, snapshot, now }: { candidate: CandidateDescriptor; snapshot: CandidateSnapshot; now: number }) {
  const { proofs, gaps, available } = candidateReadiness(candidate, snapshot, now)
  return <section aria-label="Readiness and proof" className="dp-receipts">
    <h3>Readiness and proof</h3>
    <ReadinessStatus candidate={candidate} snapshot={snapshot} now={now} />
    <p>Target: {snapshot.target.buildId || 'No build'} · {snapshot.target.deviceId || 'No device'}</p>
    {!available && <ul aria-label="Readiness gaps">{gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
    <ul className="dp-proof-list" aria-label="Prerequisite receipts">{proofs.map(proof => <ProofReceipt key={proof.requirement.id} proof={proof} />)}</ul>
  </section>
}
