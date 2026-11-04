import type { Candidate } from "./contracts";
export interface PopulatedExample { provenance: string; summary: string; facts: readonly string[] }
/** Local illustrative content only; no retrieval, runtime model or personal source. */
export function ExamplePopulation(candidate: Candidate): PopulatedExample {
  return {
    provenance: "Synthetic sample · invented for this preview",
    summary: candidate.meaning,
    facts: candidate.steps.map(step => `${step.action} → ${step.expected}`),
  };
}
export const syntheticCandidates: readonly Candidate[] = [
  { partId: "sample-next-steps", title: "A plan for a community garden", meaning: "Turn a small garden plan into two clear next steps, keeping the original context.",
    steps: [{ id: "read", action: "Read the garden plan", expected: "A shared herb bed needs soil and a watering rota." },
      { id: "prepare", action: "Prepare next steps", expected: "Check soil on Friday; draft a weekly watering rota." }],
    proof: { kind: "missing" }, priority: "film-likely", filmSelected: true, support: "supported" },
  { partId: "sample-questions", title: "Questions for a repair café", meaning: "Keep open questions beside a repair café plan so the next review has a clear starting point.",
    steps: [{ id: "read", action: "Read the repair café plan", expected: "A Saturday session needs a room and volunteer tools." },
      { id: "ask", action: "Keep open questions", expected: "Is the room accessible? Who can bring a tool kit?" }],
    proof: { kind: "supplied", label: "Sample descriptor only; no runtime demonstration", reference: "synthetic:repair-cafe" },
    priority: "judge", filmSelected: false, support: "supported" },
];
