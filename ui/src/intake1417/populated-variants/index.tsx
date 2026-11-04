import { useEffect, useState } from "react";
import type { Candidate, PopulatedVariantsAdapter, PreferenceStore, ReviewState } from "./contracts";
import { CandidateInput } from "./CandidateInput";
import { chooseVersion, getReview, readReviewState } from "./preferences";
import { ReviewCoverage } from "./ReviewCoverage";
import { VariantComparison } from "./VariantComparison";
import "./styles.css";
export { populatedVariantsFeature } from "./contracts";
export type { Candidate, DemoStep, PopulatedVariantsAdapter, PreferenceStore, ReviewState, PartReview, ReviewPriority, SuppliedProof, VariantId } from "./contracts";
function readCandidates(adapter: PopulatedVariantsAdapter): { candidates: Candidate[]; error: string } {
  try { return { candidates: CandidateInput(adapter.getCandidates()), error: "" }; }
  catch { return { candidates: [], error: "Candidates unavailable. Check the supplied IDs and adapter, then reopen this feature." }; }
}
function useCandidateInput(adapter: PopulatedVariantsAdapter) {
  const [input, setInput] = useState(() => readCandidates(adapter));
  useEffect(() => adapter.subscribe?.(() => setInput(readCandidates(adapter))), [adapter]);
  return input;
}
function useReviewChoices(preferences: PreferenceStore) {
  const [loaded] = useState(() => {
    try { return { state: readReviewState(preferences.load()), error: "" }; }
    catch { return { state: readReviewState(null), error: "Saved choices could not be read. Choices apply for this visit until saving succeeds." }; }
  });
  const [storageError, setStorageError] = useState(loaded.error);
  const [state, setState] = useState<ReviewState>(loaded.state);
  const update = (next: ReviewState) => {
    setState(next);
    try { preferences.save(next); setStorageError(""); }
    catch { setStorageError("Choice kept for this visit only. Local saving is unavailable."); }
  };
  return { state, update, storageError };
}
function CandidateNavigation({ candidates, activeId, state, select }: {
  candidates: readonly Candidate[]; activeId?: string; state: ReviewState; select(id: string): void;
}) {
  return <nav aria-label="Candidates" className="pv-candidates">{candidates.map(candidate => <div key={candidate.partId}>
    <button type="button" aria-current={candidate.partId === activeId ? "true" : undefined} onClick={() => select(candidate.partId)}>{candidate.title}</button>
    <ReviewCoverage candidate={candidate} review={getReview(state, candidate.partId)} />
  </div>)}</nav>;
}
function EnabledVariants({ adapter }: { adapter: PopulatedVariantsAdapter }) {
  const input = useCandidateInput(adapter);
  const { state, update, storageError } = useReviewChoices(adapter.preferences);
  const active = input.candidates.find(candidate => candidate.partId === state.activePartId) ?? input.candidates[0];
  return <section className="pv-root" aria-label="Populated variants">
    <header><p className="pv-eyebrow">Candidate reading area</p><h1>Find the clearest version</h1>
      <p>Small synthetic examples for presentation review. The director keeps control of the final story.</p></header>
    {input.error && <p role="alert">{input.error}</p>}{storageError && <p role="alert">{storageError}</p>}
    <CandidateNavigation candidates={input.candidates} activeId={active?.partId} state={state}
      select={activePartId => update({ ...state, activePartId })} />
    {active ? <VariantComparison key={active.partId} candidate={active} review={getReview(state, active.partId)}
      choose={version => update(chooseVersion(state, active.partId, version))}
      markReviewed={reviewed => update({ ...state, parts: { ...state.parts, [active.partId]: { ...(getReview(state, active.partId)), reviewed } } })} /> : !input.error && <p>No candidates supplied yet.</p>}
  </section>;
}
/** Off is inert: no adapter reads, storage reads, subscriptions or external actions. */
export function PopulatedVariants({ enabled = false, adapter }: { enabled?: boolean; adapter: PopulatedVariantsAdapter }) {
  return enabled ? <EnabledVariants adapter={adapter} /> : null;
}
