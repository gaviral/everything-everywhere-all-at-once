import { useState } from 'react'
import type { CandidateDescriptor, SelectionAdapter } from './contracts'

export function DemoSelection({ candidate, selected, selection }: { candidate: CandidateDescriptor; selected: boolean; selection: SelectionAdapter }) {
  const [error, setError] = useState('')
  function toggleSelection() {
    try {
      selection.setSelected(candidate.id, !selected)
      setError('')
    } catch {
      setError('Choice could not be saved. Try again.')
    }
  }
  return <div className="dp-selection">
    <button type="button" aria-pressed={selected} aria-label={`${selected ? 'Deselect' : 'Select'} ${candidate.name}`} onClick={toggleSelection}>{selected ? 'Selected · deselect' : 'Select candidate'}</button>
    {error && <p role="alert">{error}</p>}
  </div>
}

export function SelectionSummary({ candidates, selected }: { candidates: readonly CandidateDescriptor[]; selected: readonly string[] }) {
  const known = new Map(candidates.map(candidate => [candidate.id, candidate.name]))
  return <p role="status" className="dp-summary">{selected.length === 0 ? 'No candidates selected.' : `Selected: ${selected.map(id => known.get(id) ?? 'Unavailable candidate (choice retained)').join(', ')}.`} All alternatives remain in the candidate list.</p>
}
