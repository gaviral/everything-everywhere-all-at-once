import { DemoParts } from './DemoParts'

export { DemoParts }
export type * from './contracts'
export { candidateReadiness, resolveProof } from './readiness'

export const demoPartsFeature = {
  id: 'intake1411-demo-parts',
  label: 'Demo candidates',
  defaultEnabled: false,
  Component: DemoParts,
} as const
