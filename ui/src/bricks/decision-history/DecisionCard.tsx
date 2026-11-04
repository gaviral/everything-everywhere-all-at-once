import type { BrickActions } from "../contract";
import { decisionFor, replacementOf, type Decision, type Entry, type Ledger, type Source } from "./model";
import { SourceEvidence } from "./SourceEvidence";

export function DecisionCard({ entry, ledger, sources, actions, example, start, reveal }: {
  entry: Entry; ledger: Ledger; sources: Source[]; actions: BrickActions; example: boolean;
  start: (entry: Entry) => void; reveal: (id: string) => void;
}) {
  const replacement = replacementOf(entry, ledger);
  const resolved = entry.kind === "review" ? decisionFor(entry, ledger) : undefined;
  const previous = entry.kind === "decision" ? ledger.entries.find(item => item.id === entry.supersedes) as Decision | undefined : undefined;
  const status = entry.kind === "review" ? "Review" : replacement ? "Superseded" : "Current decision";
  return <article className={`decision-history-card decision-history-card-${entry.kind}${replacement ? " decision-history-past" : ""}`} data-record={entry.id} tabIndex={-1}>
    <div className="decision-history-card-top"><span className="decision-history-state">{status}</span><span className="decision-history-meta">{entry.source.topic}</span></div>
    <p className="decision-history-question">{entry.question}</p>
    <h2>{entry.kind === "decision" ? entry.outcome : "Still a question."}</h2>
    {entry.kind === "decision" && <div className="decision-history-condition"><span>Applies when</span><strong>{entry.condition}</strong></div>}
    <div className="decision-history-reason"><h3>{entry.kind === "decision" ? "Why this won" : "Review notes"}</h3><p>{entry.reason}</p></div>
    <p className="decision-history-meta">Recorded by {entry.actor} · {new Date(entry.at).toLocaleString()}</p>
    {previous && <p className="decision-history-relationship">Replaces <button type="button" onClick={() => reveal(previous.id)}>{previous.outcome} ↗</button></p>}
    {replacement && <p className="decision-history-relationship">Superseded by <button type="button" onClick={() => reveal(replacement.id)}>{replacement.outcome} ↗</button></p>}
    {resolved && <p className="decision-history-relationship">Decision recorded separately <button type="button" onClick={() => reveal(resolved.id)}>{resolved.outcome} ↗</button></p>}
    <SourceEvidence entry={entry} sources={sources} actions={actions} example={example} />
    {!replacement && !resolved && <button type="button" className="decision-history-revise" onClick={() => start(entry)}>{entry.kind === "decision" ? "Supersede with a new decision" : "Record a decision from this review"} <span aria-hidden="true">↗</span></button>}
  </article>;
}
