import { useState } from 'react'
import type { DemoPartsAdapter } from './contracts'
import { DemoParts } from './DemoParts'

export function SyntheticPreview({ adapter }: { adapter: DemoPartsAdapter }) {
  const [enabled, setEnabled] = useState(false)
  return <main className="demo-parts">
    <section aria-label="Synthetic preview controls">
      <h1>Synthetic demo review</h1>
      <p>Two illustrative candidates. Receipt links are examples. Choices last for this preview session.</p>
      <button type="button" aria-pressed={enabled} onClick={() => setEnabled(value => !value)}>{enabled ? 'Disable demo candidates' : 'Enable demo candidates'}</button>
      <p role="status">{enabled ? 'Feature enabled for this preview.' : 'Feature off. Saved choices are retained.'}</p>
    </section>
    <DemoParts enabled={enabled} adapter={adapter} />
  </main>
}
