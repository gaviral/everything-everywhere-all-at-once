import { PARTS, type PromptPart } from "./records";

export function Catalog({ selected, busy, choose }: { selected: string; busy: boolean; choose: (part: PromptPart) => void }) {
  return <section className="prompt-parts-catalog" aria-labelledby="prompt-parts-catalog-title">
    <div className="prompt-parts-section-title"><h2 id="prompt-parts-catalog-title">A small part for the next step.</h2><span>12 parts · one job each</span></div>
    <div className="prompt-parts-grid">{PARTS.map((part, index) => <button key={part.id} type="button" disabled={busy}
      className={`prompt-parts-card ${selected === part.id ? "prompt-parts-selected" : ""}`} aria-pressed={selected === part.id} onClick={() => choose(part)}>
      <span className="prompt-parts-card-top"><span className="prompt-parts-mark" aria-hidden="true">{part.mark}</span><span>{part.group}</span><span>{String(index + 1).padStart(2, "0")}</span></span>
      <strong>{part.name}</strong><span className="prompt-parts-job">{part.job}</span>
      <span className="prompt-parts-card-foot">{selected === part.id ? "Selected" : "Use this part"}<span aria-hidden="true">↗</span></span>
    </button>)}</div>
  </section>;
}
