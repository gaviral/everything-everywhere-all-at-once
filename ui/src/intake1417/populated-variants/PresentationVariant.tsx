import type { Candidate, VariantId } from "./contracts";
import type { PopulatedExample } from "./ExamplePopulation";
export const versionLabel = (id: VariantId) => id === "outline" ? "A · Reading outline" : "B · Step cards";
function SampleFacts({ facts, cards }: { facts: readonly string[]; cards: boolean }) {
  return <ol className={cards ? "pv-step-cards" : "pv-step-outline"}>{facts.map((fact, i) => <li key={i}>{fact}</li>)}</ol>;
}
export function PresentationVariant({ candidate, example, version }: { candidate: Candidate; example: PopulatedExample; version: VariantId }) {
  return <div className={`pv-presentation pv-${version}`}>
    <p className="pv-provenance">{example.provenance}</p><h4>{candidate.title}</h4>
    <p>{example.summary}</p><SampleFacts facts={example.facts} cards={version === "cards"} />
  </div>;
}
