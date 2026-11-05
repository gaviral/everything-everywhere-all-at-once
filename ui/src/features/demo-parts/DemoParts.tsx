import { useSyncExternalStore } from 'react'
import type { DemoPartsAdapter } from './contracts'
import { CandidateCatalog } from './CandidateCatalog'
import { CandidatePreview } from './CandidatePreview'
import { SelectionSummary } from './DemoSelection'
import { useCandidateVisit } from './useCandidateVisit'
import { useReceiptClock } from './useReceiptClock'
import './demo-parts.css'

function ActiveDemoParts({ adapter }: { adapter: DemoPartsAdapter }) {
  const snapshot = useSyncExternalStore(adapter.catalog.subscribe, adapter.catalog.getSnapshot, adapter.catalog.getSnapshot)
  const selected = useSyncExternalStore(adapter.selection.subscribe, adapter.selection.getSnapshot, adapter.selection.getSnapshot)
  const now = useReceiptClock(snapshot.receipts)
  const visit = useCandidateVisit(snapshot.candidates.map(candidate => candidate.id))
  const candidate = snapshot.candidates.find(item => item.id === visit.inspectedId)
  return <div className="demo-parts">
    <header><p className="dp-eyebrow">Demo candidates</p><h1>Choose a small story</h1>
      <p>Inspect each part and its proof. Select candidates for review; the director chooses the final story.</p>
    </header>
    <SelectionSummary candidates={snapshot.candidates} selected={selected} />
    {!snapshot.connected && <p role="status" className="dp-notice">Proof source disconnected. Choices remain available.</p>}
    {candidate
      ? <CandidatePreview candidate={candidate} snapshot={snapshot} selected={selected.includes(candidate.id)} selection={adapter.selection} now={now} onReturn={visit.onReturn} />
      : <CandidateCatalog snapshot={snapshot} selected={selected} selection={adapter.selection} now={now} inspect={visit.inspect} inspectRef={visit.inspectRef} />}
  </div>
}

export function DemoParts({ enabled = false, adapter }: { enabled?: boolean; adapter: DemoPartsAdapter }) {
  return enabled ? <ActiveDemoParts adapter={adapter} /> : null
}
