import type { BrickActions } from "../contract";
import { sourceState, type Entry, type Source } from "./model";

export function SourceEvidence({ entry, sources, actions, example }: { entry: Entry; sources: Source[]; actions: BrickActions; example: boolean }) {
  const status = sourceState(entry.source, sources);
  return <details className="decision-history-evidence">
    <summary>Source & topic context <span>{entry.context.length} captured {entry.context.length === 1 ? "turn" : "turns"}</span></summary>
    <p className="decision-history-meta">{entry.source.topic} · {entry.source.speaker} · {new Date(entry.source.at).toLocaleString()}</p>
    <blockquote>{entry.source.text}</blockquote>
    {!example && <>
      {status !== "available" && <p className="decision-history-warning">{status === "missing" ? "Source is no longer on this map." : "Source words have changed."} The captured words remain here.</p>}
      <button type="button" disabled={status !== "available"} onClick={() => actions.openThought(entry.source.id)}>Open original source ↗</button>
    </>}
    {entry.context.filter(source => source.id !== entry.source.id).map(source => <div className="decision-history-context" key={source.id}>
      <p className="decision-history-meta">{source.speaker} · {new Date(source.at).toLocaleString()}</p><p>{source.text}</p>
    </div>)}
    <p className="decision-history-meta">Captured when recorded. Later discussion does not rewrite this context.</p>
  </details>;
}
