export type ProofState = 'demonstrated' | 'missing' | 'stale' | 'disconnected'

export interface EvidenceLink {
  label: string
  href: string
}

export interface ProofRequirement {
  id: string
  label: string
  kind: 'reload' | 'device' | 'other'
  evidenceId: string
  reference?: EvidenceLink
}

export interface DemoStepDescriptor {
  id: string
  name: string
  action: string
  expectedResult: string
}

export interface CandidateDescriptor {
  id: string
  name: string
  description: string
  duties: readonly string[]
  featureSwitch: { id: string; enabled: boolean }
  prerequisites: readonly ProofRequirement[]
  steps: readonly DemoStepDescriptor[]
}

export interface EvidenceReceipt {
  id: string
  kind: ProofRequirement['kind']
  state: ProofState
  scope: 'synthetic' | 'live'
  summary: string
  observedAt?: string
  freshUntil?: string
  buildId?: string
  deviceId?: string
  source?: EvidenceLink
}

export interface CandidateSnapshot {
  connected: boolean
  target: { buildId: string; deviceId: string }
  candidates: readonly CandidateDescriptor[]
  receipts: readonly EvidenceReceipt[]
}

/** Snapshots must retain identity until changed. Subscribe must return an unsubscribe function.
 * Catalog reads and subscriptions are read-only: they must never launch or capture anything.
 * The host owns storage durability and target identity; disabling leaves both stores intact. */
export interface ReadablePart<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface SelectionAdapter extends ReadablePart<readonly string[]> {
  setSelected(candidateId: string, selected: boolean): void
}

export interface DemoPartsAdapter {
  catalog: ReadablePart<CandidateSnapshot>
  selection: SelectionAdapter
}
