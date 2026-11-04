import { MATCHERS } from "./matcher-controls-part";
import type { Breakdown, Dispute } from "./types";
export function StartedParts({ result, disputes, selected, select }: { result: Breakdown; disputes: Dispute[]; selected: string | null; select: (id: string) => void }) {
  return <section className="trigger-parts-output" aria-label="Started parts">
    <div className="trigger-parts-section-heading"><h2>One stream. <em>{result.parts.length} {result.parts.length === 1 ? "beginning" : "beginnings"}.</em></h2><span>PHRASE → MATCHER → PART</span></div>
    <div className="trigger-parts-ribbon">{result.parts.length ? result.parts.map((part, index) => {
      const trigger = part.trigger;
      const matcher = MATCHERS.find(value => value.id === trigger?.matcher);
      const challenged = disputes.some(row => row.id === trigger?.id);
      return <article className={`trigger-parts-started trigger-parts-${trigger?.matcher ?? "opening"}`} key={part.item.id} data-selected={trigger?.id === selected}>
        <div className="trigger-parts-cause"><span className="trigger-parts-kicker">{trigger ? `“${trigger.phrase}”` : "FIRST WORDS"}</span><span aria-hidden="true">↘</span></div>
        <div className="trigger-parts-started-heading"><span className="trigger-parts-number">{String(index + 1).padStart(2, "0")}</span><div><span className="trigger-parts-kicker">{matcher?.name ?? "Opening part"}{trigger?.matcher === "ai" ? trigger.example ? " · example" : " · live result" : ""}</span><h3>Part {index + 1}</h3></div></div>
        <p className="trigger-parts-words">{part.item.source.text.trim()}</p>
        {trigger ? <><p className="trigger-parts-reason">{trigger.reason}</p><button type="button" onClick={() => select(trigger.id)} aria-pressed={selected === trigger.id}>{challenged ? "Dispute recorded ↗" : "Dispute this split ↗"}</button></> : <p className="trigger-parts-reason">The stream starts here. Every original word stays with its part.</p>}
      </article>;
    }) : <p className="trigger-parts-empty">Add some words above to see where ideas begin.</p>}</div>
  </section>;
}
