import { useRef, useState } from "react";
import type { Candidate, PartReview, VariantId } from "./contracts";
import { ExamplePopulation } from "./ExamplePopulation";
import { PresentationVariant, versionLabel } from "./PresentationVariant";
interface Props { candidate: Candidate; review: PartReview; choose(version: VariantId): void; markReviewed(reviewed: boolean): void }
function IterationRecord({ review }: { review: PartReview }) {
  return <details><summary>Choice history ({review.iterations.length})</summary>
    {review.iterations.length ? <ol>{review.iterations.map((id, i) => <li key={i}>{versionLabel(id)}</li>)}</ol> : <p>No choice recorded yet.</p>}
  </details>;
}
export function VariantComparison({ candidate, review, choose, markReviewed }: Props) {
  const [detail, setDetail] = useState<VariantId | null>(null);
  const returnButton = useRef<HTMLButtonElement | null>(null);
  const returnVersion = useRef<VariantId | null>(null);
  const example = ExamplePopulation(candidate);
  const closeDetail = () => { setDetail(null); requestAnimationFrame(() => returnButton.current?.focus()); };
  if (detail) return <section aria-label="Version detail" onKeyDown={event => { if (event.key === "Escape") closeDetail(); }}>
    <button type="button" onClick={closeDetail}>Back to comparison</button>
    <h3 tabIndex={-1} ref={element => { element?.focus(); }}>{versionLabel(detail)} · detail</h3>
    <PresentationVariant candidate={candidate} example={example} version={detail} />
    <p>Proof: {candidate.proof.kind === "missing" ? "Missing · not demonstrated" : `${candidate.proof.label} (${candidate.proof.reference})`}</p>
    <p>The sample illustrates the descriptor. It does not prove the candidate works in the app.</p>
  </section>;
  return <section aria-label="Version comparison">
    <h3>Same content, two ways to read it</h3><p>Choose a presentation. Both alternatives remain available.</p>
    <p role="status">{review.chosen ? `Kept ${versionLabel(review.chosen)}` : "No version chosen"}</p>
    <div className="pv-versions">{(["outline", "cards"] as const).map(version => <article key={version} aria-label={versionLabel(version)} className={review.chosen === version ? "pv-version pv-chosen" : "pv-version"}>
      <h3>{versionLabel(version)}</h3><PresentationVariant candidate={candidate} example={example} version={version} />
      <div className="pv-actions"><button type="button" aria-pressed={review.chosen === version} onClick={() => choose(version)}>Keep {versionLabel(version)}</button>
        <button type="button" ref={element => { if (returnVersion.current === version) returnButton.current = element; }} onClick={event => { returnVersion.current = version; returnButton.current = event.currentTarget; setDetail(version); }}>Detail {version === "outline" ? "A" : "B"}</button></div>
    </article>)}</div>
    <div className="pv-actions"><button type="button" aria-pressed={review.reviewed} onClick={() => markReviewed(!review.reviewed)}>{review.reviewed ? "Mark unreviewed" : "Mark reviewed"}</button></div>
    <IterationRecord review={review} />
  </section>;
}
