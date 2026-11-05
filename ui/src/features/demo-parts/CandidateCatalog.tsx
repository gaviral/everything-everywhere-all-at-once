import type { RefCallback } from 'react'
import type { CandidateDescriptor, CandidateSnapshot, SelectionAdapter } from './contracts'
import { DemoSelection } from './DemoSelection'
import { ReadinessStatus } from './ReadinessReceipt'

export function CandidateIdentity({ candidate }: { candidate: CandidateDescriptor }) {
  return <>
    <p>{candidate.description}</p>
    <p className="dp-meta">Duties: {candidate.duties.join(', ') || 'Not supplied'}<br />Switch: {candidate.featureSwitch.id} · {candidate.featureSwitch.enabled ? 'on' : 'off'}</p>
  </>
}

interface CatalogProps {
  snapshot: CandidateSnapshot
  selected: readonly string[]
  selection: SelectionAdapter
  now: number
  inspect(id: string): void
  inspectRef(id: string): RefCallback<HTMLButtonElement>
}

function CandidateCard({ candidate, snapshot, selected, selection, now, inspect, inspectRef }: CatalogProps & { candidate: CandidateDescriptor }) {
  return <li className="dp-card">
    <h3>{candidate.name}</h3>
    <CandidateIdentity candidate={candidate} />
    <ReadinessStatus candidate={candidate} snapshot={snapshot} now={now} />
    <p>{candidate.steps.length} named steps · {candidate.prerequisites.length} requirements</p>
    <div className="dp-actions">
      <button type="button" ref={inspectRef(candidate.id)} onClick={() => inspect(candidate.id)}>Inspect {candidate.name}</button>
      <DemoSelection candidate={candidate} selected={selected.includes(candidate.id)} selection={selection} />
    </div>
  </li>
}

export function CandidateCatalog({ snapshot, selected, selection, now, inspect, inspectRef }: CatalogProps) {
  return <section aria-label="Demo candidates">
    <h2>Demo candidates</h2>
    {snapshot.candidates.length === 0 && <p>No candidates supplied yet. Saved choices are retained.</p>}
    <ul className="dp-catalog">{snapshot.candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} snapshot={snapshot} selected={selected} selection={selection} now={now} inspect={inspect} inspectRef={inspectRef} />)}</ul>
  </section>
}
