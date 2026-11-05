export type SourceIdentity = { revision: string; kind: 'synthetic' | 'git-commit' };
export type ArtifactIdentity = SourceIdentity & { fingerprint: string };
export type Availability = 'available' | 'prerequisite-missing' | 'unsupported';
export type Capability = {
  id: string; label: string; local: Availability; hosted: Availability; reason: string;
};
export type Switch = { id: string; defaultEnabled: false; enabled: false };
export type HostingRequirement = { id: string; requirement: string; evidence: 'MISSING' };
export type CandidateManifest = {
  schemaVersion: 1;
  purpose: 'synthetic-dry-run';
  source: SourceIdentity;
  capabilities: Capability[];
  switches: Switch[];
  hosting: HostingRequirement[];
  fixture: { session: 'Example session'; notes: ['Example note'] };
  deployment: { revision: 'MISSING'; phone: 'MISSING'; tls: 'MISSING' };
};
export type CandidateArtifact = { manifest: CandidateManifest; fingerprint: string };
export type PromotionPlan = {
  mode: 'dry-run';
  from: ArtifactIdentity;
  to: ArtifactIdentity;
  rollback: ArtifactIdentity;
  steps: string[];
  blockers: string[];
};
