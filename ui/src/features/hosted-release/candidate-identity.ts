import type { ArtifactIdentity, CandidateArtifact, SourceIdentity } from './contracts';

export function validateSource(source: SourceIdentity): void {
  if (!source || Object.keys(source).sort().join(',') !== 'kind,revision'
    || !/^[a-f0-9]{40}$/.test(source.revision) || !['synthetic', 'git-commit'].includes(source.kind)) {
    throw new Error('An exact full revision and an explicit source kind are required.');
  }
}

// Sorting object keys gives both browser and package writer identical fingerprint bytes.
export function canonicalBytes(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalBytes(record[key])}`).join(',')}}`;
}

export async function fingerprintOf(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBytes(value)));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function artifactIdentity(artifact: CandidateArtifact): ArtifactIdentity {
  return { ...artifact.manifest.source, fingerprint: artifact.fingerprint };
}

export function sameIdentity(left: ArtifactIdentity, right: ArtifactIdentity): boolean {
  return left.revision === right.revision && left.kind === right.kind && left.fingerprint === right.fingerprint;
}
