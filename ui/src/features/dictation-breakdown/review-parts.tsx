import { useRef } from "react";
import type { Item, Kind, QueueHome } from "./contract";
import { characters } from "./source-span";
import { proposeQueues } from "./queue-proposal";

export function QueueProposals({ item, homes }: { item: Item; homes: readonly QueueHome[] }) {
  const proposals = proposeQueues(item, homes);
  return <section aria-label="Queue suggestions"><strong>Suggested homes</strong>
    {proposals.length ? <ul>{proposals.map(proposal => <li key={proposal.id}>{proposal.name}
      {proposal.duplicate && <span> · Possible duplicate home</span>}<small>{proposal.reason}</small></li>)}</ul> : <p>No match. Choose a home during workflow review.</p>}
  </section>;
}

export function SourceSpanReview({ item, onSplit }: { item: Item; onSplit: (offset: number) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  return <section><label>Original source · characters {item.source.start}–{item.source.end}
    <textarea ref={area} aria-label={`Source for ${item.id}`} readOnly value={item.source.text} rows={4} /></label>
    <p className="db-help">Place the cursor before a new idea in the source, then split. Ranges start at zero; the end is excluded.</p>
    <button type="button" onClick={() => {
      const field = area.current;
      if (field) onSplit(item.source.start + characters(field.value.slice(0, field.selectionStart)).length);
    }}>Split at source cursor</button>
  </section>;
}

type ItemReviewProps = { item: Item; ordinal: number; homes: readonly QueueHome[];
  onCorrect: (patch: Partial<Pick<Item, "what" | "why" | "kind" | "reviewedBy">>) => void;
  onSplit: (offset: number) => void; onRejoin: () => void };
export function ItemReview({ item, ordinal, homes, onCorrect, onSplit, onRejoin }: ItemReviewProps) {
  return <article className="db-item" aria-label={`Item ${ordinal}`} data-item-id={item.id}>
    <header><h3>Item {ordinal}</h3><span>{item.reviewedBy === "unreviewed" ? "Needs review" : `Reviewed: ${item.reviewedBy}`}</span></header>
    <label>What<textarea aria-label={`What for item ${ordinal}`} value={item.what} rows={3} onChange={event => onCorrect({ what: event.target.value })} /></label>
    <label>Why · {item.reasonOrigin}<input aria-label={`Why for item ${ordinal}`} value={item.why} placeholder="Reason not stated" onChange={event => onCorrect({ why: event.target.value })} /></label>
    <label>Kind<select aria-label={`Kind for item ${ordinal}`} value={item.kind} onChange={event => onCorrect({ kind: event.target.value as Kind })}>
      <option value="action">Action</option><option value="question">Question</option><option value="note">Note</option>
    </select></label>
    <SourceSpanReview item={item} onSplit={onSplit} />
    <p className="db-help">Split and rejoin rebuild summaries from source. Undo restores prior corrections.</p>
    <div className="db-actions"><button type="button" disabled={ordinal === 1} onClick={onRejoin}>Rejoin previous</button>
      <button type="button" onClick={() => onCorrect({ reviewedBy: "human" })}>Mark human reviewed</button>
      <button type="button" onClick={() => onCorrect({ reviewedBy: "red-team" })}>Mark red-team reviewed</button></div>
    <QueueProposals item={item} homes={homes} />
  </article>;
}
