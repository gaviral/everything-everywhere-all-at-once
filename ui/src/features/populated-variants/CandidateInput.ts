import type { Candidate } from "./contracts";
/** Retain every valid supplied candidate; film priority affects order only. */
export function CandidateInput(supplied: readonly Candidate[]): Candidate[] {
  const ids = new Set<string>();
  supplied.forEach(candidate => {
    if (!candidate.partId.trim() || ids.has(candidate.partId)) throw new Error("Candidates need unique stable part IDs.");
    ids.add(candidate.partId);
  });
  const rank = { "film-likely": 0, judge: 1, later: 2 };
  return [...supplied].sort((a, b) => rank[a.priority] - rank[b.priority]);
}
