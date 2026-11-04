import type { MatcherId, Switches } from "./types";
export const MATCHERS: { id: MatcherId; name: string; sample: string; explanation: string; number: string }[] = [
  { id: "exact", name: "Exact phrase", sample: "“another thing” · “by the way”", explanation: "The same words, ignoring case.", number: "01" },
  { id: "regex", name: "Pattern", sample: "“next up:” · “item 2:”", explanation: "A phrase with a repeatable shape.", number: "02" },
  { id: "fuzzy", name: "Fuzzy match", sample: "“by teh way” ≈ “by the way”", explanation: "Up to two letter edits; worth a look.", number: "03" },
  { id: "ai", name: "AI judgement", sample: "“switching gears” → new idea?", explanation: "Meaning, judged by Meta Muse Spark.", number: "04" },
];
export function MatcherControlsPart({ switches, toggle, counts }: { switches: Switches; toggle: (id: MatcherId) => void; counts: Record<MatcherId, number> }) {
  return <section className="trigger-parts-matchers" aria-label="Matchers">
    {MATCHERS.map(matcher => <article className={`trigger-parts-matcher trigger-parts-${matcher.id}`} key={matcher.id} data-enabled={switches[matcher.id]}>
      <div className="trigger-parts-matcher-top"><span className="trigger-parts-kicker">{matcher.number} / {matcher.id === "regex" ? "REGEX" : matcher.id.toUpperCase()}</span>
        <button type="button" role="switch" aria-checked={switches[matcher.id]} aria-label={matcher.name} onClick={() => toggle(matcher.id)} className="trigger-parts-switch"><span /></button></div>
      <h3>{matcher.name}</h3><p className="trigger-parts-matcher-sample">{matcher.sample}</p>
      <p>{matcher.explanation}</p><span className="trigger-parts-hit-count">{switches[matcher.id] ? `${counts[matcher.id]} fired` : "Switched off"}</span>
    </article>)}
  </section>;
}
