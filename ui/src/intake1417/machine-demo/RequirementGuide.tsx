import type { Evidence, RequirementMatch } from "./contracts";
import { readEvidence } from "./MachineInput";

export function EvidenceDate({ evidence }: { evidence: Evidence }) {
  return <small>{evidence.kind === "synthetic" ? "Synthetic evidence" : "Supplied evidence"}: {evidence.source} · <time dateTime={evidence.observedAt}>{evidence.observedAt}</time></small>;
}
function SetupInstruction({ match, now }: { match: RequirementMatch; now: string }) {
  const step = match.requirement.setup;
  const evidence = readEvidence(step?.evidence, now);
  if (!step || !evidence || !step.instruction.trim()) return <p>Setup instructions are unverified. Ask the platform owner for a dated requirement and setup step.</p>;
  return <div><p>Setup: {step.instruction}</p><EvidenceDate evidence={evidence} /></div>;
}
function RequirementRow({ match, now }: { match: RequirementMatch; now: string }) {
  return <li><strong>{match.requirement.label} — {match.status}</strong>
    {match.fact ? <><p>Supplied value: {match.fact.value}.</p><EvidenceDate evidence={match.fact.evidence} /></> : <p>No valid dated evidence supplied.</p>}
    {match.status !== "available" && <><p>{match.requirement.missing}</p><SetupInstruction match={match} now={now} /></>}
  </li>;
}
export function RequirementGuide({ matches, now }: { matches: readonly RequirementMatch[]; now: string }) {
  if (!matches.length) return <p>This example only inspects built-in synthetic content. It needs no native permission.</p>;
  return <ul className="machine-demo-requirements">{matches.map(match => <RequirementRow key={match.requirement.id} match={match} now={now} />)}</ul>;
}
