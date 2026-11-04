import { useState } from "react";
import { EXAMPLES, problem, type Term } from "./rules";

export function TermEditor({ terms, change, busy }: { terms: Term[]; change: (terms: Term[]) => void; busy: boolean }) {
  const [term, setTerm] = useState("");
  const [explanation, setExplanation] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [removed, setRemoved] = useState<{ item: Term; at: number } | null>(null);
  const [error, setError] = useState("");
  const reset = () => { setTerm(""); setExplanation(""); setEditing(null); setError(""); };
  const apply = () => {
    const item = { term: term.trim(), explanation: explanation.trim() };
    const next = editing === null ? [...terms, item] : terms.map((row, i) => i === editing ? item : row);
    const issue = problem(next); setError(issue);
    if (!issue) { change(next); reset(); setRemoved(null); }
  };
  return <fieldset disabled={busy} className="my-words-editor">
    <legend>Your vocabulary · {terms.length}/30</legend>
    <div className="my-words-terms">{terms.map((row, i) => <article className="my-words-term" key={i}>
      <div><strong>{row.term}</strong>{row.explanation && <p>{row.explanation}</p>}</div>
      <div className="my-words-tools">
        <button type="button" aria-label={`Edit ${row.term}`} onClick={() => { setTerm(row.term); setExplanation(row.explanation); setEditing(i); setError(""); }}>Edit</button>
        <button type="button" aria-label={`Remove ${row.term}`} onClick={() => { setRemoved({ item: row, at: i }); change(terms.filter((_, index) => index !== i)); reset(); }}>Remove</button>
      </div>
    </article>)}</div>
    {removed && <div className="my-words-undo">Removed {removed.item.term} from draft. <button type="button" onClick={() => {
      const next = [...terms]; next.splice(removed.at, 0, removed.item);
      const issue = problem(next); setError(issue); if (!issue) { change(next); setRemoved(null); }
    }}>Undo removal</button></div>}
    {!terms.length && <div className="my-words-examples"><p>Examples · invented names, not saved</p>
      {EXAMPLES.map(row => <button type="button" key={row.term} onClick={() => { reset(); setTerm(row.term); setExplanation(row.explanation); }}>{row.term} <span>↗</span></button>)}
      <p>Choose an example to edit, or enter your own below.</p>
    </div>}
    <div className="my-words-fields">
      <label>Exact name or term<input value={term} onChange={e => setTerm(e.target.value)} placeholder="e.g. Nerith" /></label>
      <label>What it means <span>(optional)</span><input value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="A person, project, or specialist word" /></label>
    </div>
    <p className="my-words-note">Explanations help you remember. Only the exact terms go to Meta’s recognizer.</p>
    {error && <p role="alert" className="my-words-error">{error}</p>}
    <div className="my-words-tools"><button type="button" disabled={!term.trim()} onClick={apply}>{editing === null ? "Add to draft" : "Update term"}</button>
      {editing !== null && <button type="button" onClick={reset}>Cancel edit</button>}</div>
    {(term || explanation) && <p className="my-words-note">Add or update this term before saving the list.</p>}
  </fieldset>;
}
