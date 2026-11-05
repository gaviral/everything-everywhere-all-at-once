import type { Candidate, PartReview } from "./contracts";
export function ReviewCoverage({ candidate, review }: { candidate: Candidate; review: PartReview }) {
  return <ul className="pv-status" aria-label={`Coverage for ${candidate.title}`}>
    <li>{review.reviewed ? "Reviewed" : "Unreviewed"}</li>
    <li>{candidate.filmSelected ? "Film-selected" : "Not film-selected"}</li>
    <li>{candidate.support === "supported" ? candidate.filmSelected ? "Supported" : "Supported · not shown" : "Support not supplied"}</li>
    <li>{candidate.proof.kind === "missing" ? "Proof missing · not demonstrated" : `Supplied proof: ${candidate.proof.label}`}</li>
  </ul>;
}
