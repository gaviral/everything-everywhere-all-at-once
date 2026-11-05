import type { CandidateArtifact, CandidateManifest, SourceIdentity } from './contracts';
import { canonicalBytes, fingerprintOf, validateSource } from './candidate-identity';
import { capabilityManifest, candidateSwitches } from './capability-manifest';
import { hostingContract } from './hosting-contract';

function manifestFor(source: SourceIdentity): CandidateManifest {
  validateSource(source);
  return {
    schemaVersion: 1, purpose: 'synthetic-dry-run', source: { ...source },
    capabilities: capabilityManifest(), switches: candidateSwitches(), hosting: hostingContract(),
    fixture: { session: 'Example session', notes: ['Example note'] },
    deployment: { revision: 'MISSING', phone: 'MISSING', tls: 'MISSING' },
  };
}

export async function createCandidate(source: SourceIdentity): Promise<CandidateArtifact> {
  const manifest = manifestFor(source);
  return { manifest, fingerprint: await fingerprintOf(manifest) };
}

export async function validateCandidate(value: unknown): Promise<CandidateArtifact> {
  if (!value || typeof value !== 'object') throw new Error('Candidate package is missing.');
  const artifact = value as CandidateArtifact;
  if (!artifact.manifest) throw new Error('Candidate manifest is missing.');
  const expected = manifestFor(artifact.manifest.source);
  if (canonicalBytes(artifact.manifest) !== canonicalBytes(expected)) {
    throw new Error('Candidate schema, synthetic content, capability or default-off contract is invalid.');
  }
  if (artifact.fingerprint !== await fingerprintOf(artifact.manifest)) throw new Error('Candidate fingerprint does not match its manifest bytes.');
  if (Object.keys(artifact).sort().join(',') !== 'fingerprint,manifest') throw new Error('Unexpected candidate package fields.');
  return artifact;
}
