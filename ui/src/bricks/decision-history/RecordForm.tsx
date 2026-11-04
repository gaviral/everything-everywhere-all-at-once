import { useId, useLayoutEffect, useRef, useState } from "react";
import { sourceState, type Entry, type Source } from "./model";

export type FormStart = { kind: Entry["kind"]; from?: Entry };
export function RecordForm({ start, sources, actor, blocked, save, cancel }: {
  start: FormStart; sources: Source[]; actor: string; blocked: boolean;
  save: (entry: Entry) => boolean; cancel: () => void;
}) {
  const prefix = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "nearest" }); }, []);
  const [source, setSource] = useState<Source | undefined>(() => sources.find(item => item.id === start.from?.source.id) ?? sources[0]);
  const [question, setQuestion] = useState(start.from?.question ?? "");
  const [outcome, setOutcome] = useState("");
  const [condition, setCondition] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, confirm] = useState(false);
  const [error, setError] = useState("");
  const decision = start.kind === "decision";
  const field = (name: string, value: string, change: (value: string) => void, hint?: string) => <label className="decision-history-field" htmlFor={`${prefix}-${name}`}>
    <span>{name}</span>{hint && <small>{hint}</small>}<textarea id={`${prefix}-${name}`} name={name} required maxLength={6000} rows={2} value={value} onChange={event => change(event.target.value)} />
  </label>;
  return <form className="decision-history-form" aria-label={decision ? "Record decision" : "Save review"} onSubmit={event => {
    event.preventDefault();
    if (!source || blocked) return;
    if (sourceState(source, sources) !== "available") { setError("Source changed while you were writing. Select its current words before saving."); return; }
    if (![question, reason, ...(decision ? [outcome, condition] : [])].every(value => value.trim()) || (decision && !confirmed)) { setError("Complete the fields and confirm the chosen outcome."); return; }
    const base = { id: crypto.randomUUID(), question: question.trim(), reason: reason.trim(), actor, at: Date.now(), source,
      context: sources.filter(item => item.topicId === source.topicId).map(item => ({ ...item })) };
    const entry: Entry = decision ? { ...base, kind: "decision", outcome: outcome.trim(), condition: condition.trim(),
      ...(start.from?.kind === "decision" ? { supersedes: start.from.id } : {}),
      ...(start.from?.kind === "review" ? { reviewId: start.from.id } : {}) } : { ...base, kind: "review" };
    if (save(entry)) cancel();
  }}>
    <div className="decision-history-form-top"><h2 ref={heading} tabIndex={-1}>{start.from?.kind === "decision" ? "A new choice. The old reasons stay." : decision ? "Record a chosen outcome" : "Keep the question open"}</h2><button type="button" onClick={cancel}>Cancel</button></div>
    {start.from?.kind === "decision" && <p>Superseding: <strong>{start.from.outcome}</strong>. Explain what changed in “Why this won”.</p>}
    <label className="decision-history-field" htmlFor={`${prefix}-source`}><span>Source on your map</span>
      <select id={`${prefix}-source`} value={source?.id ?? ""} required onChange={event => { setSource(sources.find(item => item.id === event.target.value)); setError(""); }}>
        {!source && <option value="">Select a source</option>}
        {sources.map(item => <option key={item.id} value={item.id}>{item.topic} · {item.speaker} · {item.text.slice(0, 100)}</option>)}
      </select>
    </label>
    {source && <blockquote>{source.text}</blockquote>}
    {field("Question", question, setQuestion)}
    {decision && field("Chosen outcome", outcome, setOutcome)}
    {decision && field("Applies when", condition, setCondition, "Keep the condition explicit, or write “No conditions”.")}
    {field(decision ? "Why this won" : "Review notes", reason, setReason)}
    {decision && <label className="decision-history-confirm"><input type="checkbox" required checked={confirmed} onChange={event => confirm(event.target.checked)} />I am recording a chosen outcome, with its reason and condition.</label>}
    {error && <p role="alert" className="decision-history-warning">{error}</p>}
    {!sources.length && <p>Add a thought to the map first so this record has a source.</p>}
    <button type="submit" className="decision-history-primary" disabled={blocked || !source}>{decision ? "Save decision" : "Save review without deciding"}</button>
  </form>;
}
