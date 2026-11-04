import type { CandidateSnapshot, DemoPartsAdapter, EvidenceReceipt, ReadablePart } from './contracts'

function mutablePart<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const part: ReadablePart<T> = {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return {
    ...part,
    update(next: T) { value = next; listeners.forEach(listener => listener()) },
    subscriberCount: () => listeners.size,
  }
}

function syntheticReceipt(id: string, kind: EvidenceReceipt['kind'], now: number): EvidenceReceipt {
  return {
    id, kind, scope: 'synthetic', state: 'demonstrated',
    summary: 'Illustrative receipt for inspecting this preview. No real reload or device was tested.',
    observedAt: new Date(now - 60_000).toISOString(), freshUntil: new Date(now + 3_600_000).toISOString(),
    buildId: 'sample-build', deviceId: 'sample-device',
    source: { label: 'Synthetic receipt reference', href: `https://example.test/demo-proof/${id}` },
  }
}

export function syntheticSnapshot(now = Date.now()): CandidateSnapshot {
  return {
    connected: true, target: { buildId: 'sample-build', deviceId: 'sample-device' },
    candidates: [
      {
        id: 'plan', name: 'Review a travel plan', description: 'Inspect a short plan and keep an alternative before choosing a story.',
        duties: ['D6', 'D52'], featureSwitch: { id: 'sample-plan', enabled: true },
        prerequisites: [
          { id: 'plan-reload', kind: 'reload', label: 'Reload continuity', evidenceId: 'plan-reload', reference: { label: 'Reload requirement reference', href: 'https://example.test/requirements/reload' } },
          { id: 'plan-device', kind: 'device', label: 'Target device', evidenceId: 'plan-device' },
        ],
        steps: [
          { id: 'open-plan', name: 'Open the plan', action: 'Open the sample travel plan.', expectedResult: 'Two proposed routes remain visible.' },
          { id: 'keep-route', name: 'Keep a route', action: 'Choose the scenic route for review.', expectedResult: 'The scenic route is selected and the direct route is still available.' },
        ],
      },
      {
        id: 'sketch', name: 'Resume a shared sketch', description: 'Inspect the return to a sample sketch on a target device.',
        duties: ['D6', 'D52'], featureSwitch: { id: 'sample-sketch', enabled: true },
        prerequisites: [
          { id: 'sketch-reload', kind: 'reload', label: 'Reload continuity', evidenceId: 'sketch-reload' },
          { id: 'sketch-device', kind: 'device', label: 'Target device', evidenceId: 'sketch-device' },
        ],
        steps: [
          { id: 'inspect-sketch', name: 'Inspect the sketch', action: 'Open the sample sketch.', expectedResult: 'The selected mark and its label are visible.' },
          { id: 'return-sketch', name: 'Return to the sketch', action: 'Leave the sample view, then return.', expectedResult: 'The same mark remains selected.' },
        ],
      },
    ],
    receipts: [syntheticReceipt('plan-reload', 'reload', now), syntheticReceipt('plan-device', 'device', now)],
  }
}

/** Memory is owned outside the view, so navigation, disable and remount keep choices.
 * The synthetic preview deliberately makes no disk-persistence or live-readiness claim. */
export function createSyntheticAdapter(now = Date.now()) {
  const catalog = mutablePart(syntheticSnapshot(now))
  const choices = mutablePart<readonly string[]>([])
  const adapter: DemoPartsAdapter = {
    catalog,
    selection: {
      getSnapshot: choices.getSnapshot,
      subscribe: choices.subscribe,
      setSelected(id, selected) {
        const current = choices.getSnapshot()
        choices.update(selected ? [...new Set([...current, id])] : current.filter(value => value !== id))
      },
    },
  }
  return { adapter, updateCatalog: catalog.update, subscribers: () => catalog.subscriberCount() + choices.subscriberCount() }
}
