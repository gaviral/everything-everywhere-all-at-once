import type { MachineSession } from "./MachineRefresh";
import type { MachineState } from "./contracts";
import { RequirementGuide } from "./RequirementGuide";

function DemoChoices({ state, select }: { state: MachineState; select: (id: string) => void }) {
  return <div className="machine-demo-choices" aria-label="Demo parts">{state.matches.map(match =>
    <button key={match.part.id} type="button" aria-pressed={state.selectedId === match.part.id} onClick={() => select(match.part.id)}>
      <strong>{match.part.title}</strong><span>{match.status}</span>
    </button>)}</div>;
}
function SelectedPart({ state, now }: { state: MachineState; now: string }) {
  const match = state.matches.find(item => item.part.id === state.selectedId);
  if (!match) return <p>No demo parts supplied.</p>;
  return <article aria-label="Selected demo part"><h3>{match.part.title}</h3>
    <p>{match.part.description}</p><p role="status">Availability: <strong>{match.status}</strong></p>
    <RequirementGuide matches={match.requirements} now={now} />
    <p className="machine-demo-note">Availability describes supplied prerequisites. This view does not run the part or request permissions.</p>
  </article>;
}
export function DemoAvailability({ state, session }: { state: MachineState; session: MachineSession }) {
  return <section className="machine-demo" aria-label="Machine demo availability">
    <header><p className="machine-demo-eyebrow">Demo readiness</p><h2>What can this machine show?</h2>
      <p>{state.profile.label}</p><p>Choose any part to inspect its requirements, including unavailable alternatives.</p></header>
    <DemoChoices state={state} select={session.select} />
    <SelectedPart state={state} now={session.getEvidenceNow()} />
    <aside aria-label="Unverified platform requirements"><h3>Still unverified</h3>
      <p>Minimum OS versions and hardware recommendations have not been supplied. A browser user agent cannot prove native app access.</p>
    </aside>
  </section>;
}
