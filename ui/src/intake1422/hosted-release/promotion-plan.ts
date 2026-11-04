import type { ArtifactIdentity, CandidateArtifact, PromotionPlan } from './contracts';
import { artifactIdentity, sameIdentity } from './candidate-identity';
import { validateCandidate } from './candidate-package';

function matchCurrent(prior: ArtifactIdentity, expectedCurrent: ArtifactIdentity): void {
  if (!expectedCurrent || !sameIdentity(prior, expectedCurrent)) throw new Error('Current identity changed or is missing. Refresh the prior-artifact receipt.');
}

export async function promotionPlan(candidate: CandidateArtifact, prior: CandidateArtifact, expectedCurrent: ArtifactIdentity): Promise<PromotionPlan> {
  await validateCandidate(candidate);
  await validateCandidate(prior);
  const from = artifactIdentity(prior), to = artifactIdentity(candidate);
  matchCurrent(from, expectedCurrent);
  if (from.kind !== to.kind) throw new Error('Synthetic and Git identities cannot be mixed in a promotion plan.');
  if (from.revision === to.revision) throw new Error('Choose a different candidate source revision.');
  return {
    mode: 'dry-run', from, to, rollback: { ...from },
    steps: [
      'Retain the prior immutable artifact and recheck its full revision and fingerprint immediately before any owner action.',
      'Have the deployment owner build and review a deployable application artifact; this synthetic package cannot be published as the app.',
      'After prerequisites pass, the deployment owner may promote the reviewed artifact with all new switches off, then verify the served identity.',
      `On failed acceptance, restore the retained prior artifact ${from.revision} with fingerprint ${from.fingerprint}, restore its switch configuration and verify the served identity. Preserve session data; no schema migration is included.`,
    ],
    blockers: [
      'This is a metadata rehearsal. No publication action is implemented.',
      ...(to.kind === 'synthetic' ? ['Synthetic revisions are fixtures, not Git commits or deployed identities.'] : []),
      ...candidate.manifest.hosting.map(item => `${item.id}: ${item.evidence} — ${item.requirement}`),
      'Live hosted SHA, phone and TLS proof: MISSING.',
    ],
  };
}
