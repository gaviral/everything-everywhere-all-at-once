import { useEffect, useRef } from 'react'
import type { CandidateDescriptor, CandidateSnapshot, SelectionAdapter } from './contracts'
import { CandidateIdentity } from './CandidateCatalog'
import { DemoStep } from './DemoStep'
import { DemoSelection } from './DemoSelection'
import { ReadinessReceipt } from './ReadinessReceipt'

export function CandidatePreview({ candidate, snapshot, selected, selection, now, onReturn }: {
  candidate: CandidateDescriptor; snapshot: CandidateSnapshot; selected: boolean; selection: SelectionAdapter; now: number; onReturn(): void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [candidate.id])
  return <section aria-label="Candidate preview">
    <button type="button" onClick={onReturn}>Back to candidates</button>
    <h2 ref={heading} tabIndex={-1}>{candidate.name}</h2>
    <CandidateIdentity candidate={candidate} />
    <p className="dp-notice">Step preview only. Actions below describe the demonstration; inspecting or selecting a candidate does not execute them.</p>
    <DemoSelection candidate={candidate} selected={selected} selection={selection} />
    <section aria-label="Named steps"><h3>Named steps</h3>
      <ol className="dp-steps">{candidate.steps.map((step, index) => <DemoStep key={step.id} step={step} number={index + 1} />)}</ol>
    </section>
    <ReadinessReceipt candidate={candidate} snapshot={snapshot} now={now} />
  </section>
}
