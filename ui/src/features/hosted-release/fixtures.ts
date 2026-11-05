import { createCandidate } from './candidate-package';

export async function syntheticCandidates() {
  const prior = await createCandidate({ revision: '1'.repeat(40), kind: 'synthetic' });
  const candidate = await createCandidate({ revision: '2'.repeat(40), kind: 'synthetic' });
  return { prior, candidate };
}
