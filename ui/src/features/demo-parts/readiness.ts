import type { CandidateDescriptor, CandidateSnapshot, EvidenceLink, EvidenceReceipt, ProofRequirement, ProofState } from './contracts'

export function safeEvidenceHref(link?: EvidenceLink): string | undefined {
  if (!link) return undefined
  try {
    const url = new URL(link.href)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* An invalid reference is shown as unavailable. */ }
  return undefined
}

function validTime(value?: string): number | undefined {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? time : undefined
}

export interface ResolvedProof {
  requirement: ProofRequirement
  receipt?: EvidenceReceipt
  state: ProofState
  reason: string
  live: boolean
}

function receiptState(receipt: EvidenceReceipt, snapshot: CandidateSnapshot, now: number): Pick<ResolvedProof, 'state' | 'reason' | 'live'> {
  if (!snapshot.connected || receipt.state === 'disconnected') return { state: 'disconnected', reason: 'Proof source is disconnected.', live: false }
  if (receipt.state === 'missing') return { state: 'missing', reason: 'The source reports no proof.', live: false }
  if (receipt.buildId !== snapshot.target.buildId || receipt.deviceId !== snapshot.target.deviceId) {
    return { state: 'stale', reason: 'Receipt belongs to a different build or device.', live: false }
  }
  const observed = validTime(receipt.observedAt)
  const expires = validTime(receipt.freshUntil)
  if (observed === undefined || expires === undefined || expires <= observed || observed > now || !safeEvidenceHref(receipt.source)) {
    return { state: 'missing', reason: 'A dated receipt with an evidence link is required.', live: false }
  }
  if (receipt.state === 'stale' || expires <= now) return { state: 'stale', reason: 'Proof needs a current receipt.', live: false }
  return { state: 'demonstrated', reason: receipt.scope === 'synthetic' ? 'Demonstrated with synthetic proof only.' : 'Current proof matches the target build and device.', live: receipt.scope === 'live' }
}

export function resolveProof(requirement: ProofRequirement, snapshot: CandidateSnapshot, now: number): ResolvedProof {
  const receipts = snapshot.receipts.filter(receipt => receipt.id === requirement.evidenceId)
  if (receipts.length !== 1) return {
    requirement, state: snapshot.connected ? 'missing' : 'disconnected', live: false,
    reason: receipts.length > 1 ? 'Conflicting receipts need review.' : snapshot.connected ? 'No receipt supplied.' : 'Proof source is disconnected.',
  }
  const receipt = receipts[0]
  if (receipt.kind !== requirement.kind) return { requirement, receipt, state: 'missing', reason: 'Receipt does not prove this kind of requirement.', live: false }
  return { requirement, receipt, ...receiptState(receipt, snapshot, now) }
}

export function candidateReadiness(candidate: CandidateDescriptor, snapshot: CandidateSnapshot, now: number) {
  const proofs = candidate.prerequisites.map(requirement => resolveProof(requirement, snapshot, now))
  const gaps: string[] = []
  if (!candidate.featureSwitch.enabled) gaps.push('Candidate switch is off.')
  if (!snapshot.connected) gaps.push('Proof source is disconnected.')
  if (!snapshot.target.buildId || !snapshot.target.deviceId) gaps.push('A target build and device are required.')
  if (!candidate.steps.length) gaps.push('No demonstration steps supplied.')
  for (const kind of ['reload', 'device'] as const) {
    if (!candidate.prerequisites.some(requirement => requirement.kind === kind)) gaps.push(`No ${kind} requirement supplied.`)
  }
  for (const proof of proofs) if (!proof.live) gaps.push(`${proof.requirement.label}: ${proof.reason}`)
  return { proofs, gaps, available: gaps.length === 0 }
}

export function nextProofExpiry(receipts: readonly EvidenceReceipt[], now: number): number | undefined {
  const future = receipts.map(receipt => validTime(receipt.freshUntil)).filter((time): time is number => time !== undefined && time > now)
  return future.length ? Math.min(...future) : undefined
}
