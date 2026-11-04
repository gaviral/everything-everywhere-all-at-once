import type { BrickActions } from "../contract";
import type { Source } from "./model";

export function SourceCard({ source, example, actions }: { source: Source; example: boolean; actions: BrickActions }) {
  return <article className="i-compact-source" aria-label={`Source ${source.id}`}>
    <p className="i-compact-meta">{source.speaker}{source.ai ? " · AI participant" : ""} · {example ? "Example point" : "Existing map point"}</p>
    <p className="i-compact-point">{source.concise || "No source wording available."}</p>
    {source.uncertainty && <p className="i-compact-warning">{source.uncertainty}</p>}
    <details className="i-compact-reason"><summary>Why this wording?</summary>
      <p>{example ? "This illustrative concise point preserves the condition in the example original."
        : "This is the existing map point, linked to one original. It has not been independently verified against that original."}</p>
      {source.reason && <p>Recorded placement reason: {source.reason}</p>}
    </details>
    <details className="i-compact-original"><summary>Read exact original <span aria-hidden="true">↗</span></summary>
      <p className="i-compact-meta">Source ID · {source.id}</p>
      <blockquote>{source.original || "Original text is unavailable; the map point is shown above."}</blockquote>
      {!example && <button type="button" onClick={() => actions.openThought(source.id)}>Open on map</button>}
    </details>
  </article>;
}
