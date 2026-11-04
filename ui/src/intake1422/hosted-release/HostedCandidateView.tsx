import { useEffect, useState } from 'react';
import type { ArtifactIdentity, CandidateArtifact, PromotionPlan } from './contracts';
import { inspectionEnabled } from './feature';
import { promotionPlan } from './promotion-plan';
import './hosted-release.css';

export type HostedCandidateProps = {
  enabled?: boolean;
  candidate: CandidateArtifact;
  prior: CandidateArtifact;
  expectedCurrent: ArtifactIdentity;
};

function IdentityPart({ title, identity }: { title: string; identity: ArtifactIdentity }) {
  return <section><h3>{title}</h3><p>{identity.kind === 'synthetic' ? 'Synthetic revision fixture' : 'Git source commit (not deployed identity)'}</p>
    <dl><dt>Exact revision</dt><dd><code>{identity.revision}</code></dd><dt>Manifest fingerprint</dt><dd><code>{identity.fingerprint}</code></dd></dl></section>;
}

function AvailabilityPart({ candidate }: { candidate: CandidateArtifact }) {
  return <section><h3>Feature availability</h3><div className="hosted-release-table"><table>
    <thead><tr><th>Capability</th><th>Local</th><th>Hosted</th><th>Prerequisite / limit</th></tr></thead>
    <tbody>{candidate.manifest.capabilities.map(row => <tr key={row.id}><th scope="row">{row.label}</th>
      <td>{row.local}</td><td>{row.hosted}</td><td>{row.reason}</td></tr>)}</tbody>
  </table></div></section>;
}

function SwitchesPart({ candidate }: { candidate: CandidateArtifact }) {
  return <section><h3>Packaged switches</h3><p>Inspection is opted in only for this preview. Packaged defaults stay off.</p>
    <ul>{candidate.manifest.switches.map(item => <li key={item.id}><code>{item.id}</code>: default OFF · packaged OFF</li>)}</ul></section>;
}

function PlanPart({ plan }: { plan: PromotionPlan }) {
  return <section><h3>Reversible promotion plan — dry run</h3><ol>{plan.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <IdentityPart title="Rollback restores prior identity" identity={plan.rollback} />
    <h3>Missing prerequisites</h3><ul>{plan.blockers.map(item => <li key={item}>{item}</li>)}</ul></section>;
}

type Inspection = { input: HostedCandidateProps; plan?: PromotionPlan; error?: string };

function VerifiedInspection(props: HostedCandidateProps) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  useEffect(() => {
    let active = true;
    promotionPlan(props.candidate, props.prior, props.expectedCurrent).then(
      plan => { if (active) setInspection({ input: props, plan }); },
      error => { if (active) setInspection({ input: props, error: error instanceof Error ? error.message : 'Invalid candidate.' }); },
    );
    return () => { active = false; };
  }, [props]);
  // Do not show the previous candidate's validated plan while new inputs are being checked.
  if (!inspection || inspection.input !== props) return <p role="status">Verifying candidate identity…</p>;
  if (inspection.error) return <p role="alert">Candidate rejected: {inspection.error}</p>;
  if (!inspection.plan) return null;
  return <><IdentityPart title="Candidate artifact" identity={inspection.plan.to} />
    <IdentityPart title="Prior artifact (expected current for this rehearsal)" identity={inspection.plan.from} />
    <AvailabilityPart candidate={props.candidate} /><SwitchesPart candidate={props.candidate} /><PlanPart plan={inspection.plan} /></>;
}

export function HostedCandidateView(props: HostedCandidateProps) {
  if (!inspectionEnabled(props.enabled)) return null;
  return <article className="hosted-release" aria-label="Hosted candidate inspection"><header><p className="hosted-release-eyebrow">LOCAL · SYNTHETIC DATA · NO PUBLICATION</p>
    <h2>Hosted candidate inspection</h2><p>Review source identity, availability and rollback before an owner considers a public update.</p>
    <p><strong>Live hosted SHA: MISSING · Phone: MISSING · TLS: MISSING</strong></p></header><VerifiedInspection {...props} /></article>;
}
