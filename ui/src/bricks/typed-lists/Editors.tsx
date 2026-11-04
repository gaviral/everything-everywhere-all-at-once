import { useState } from "react";
import type { Field, RecordCard, Schema } from "./model";
import { recordProblem, schemaProblem } from "./model";

export function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  return <label>{field.name}{field.kind === "choice"
    ? <select value={value} onChange={e => onChange(e.target.value)}><option value="">Unassigned</option>{field.options.map(option => <option key={option}>{option}</option>)}</select>
    : <input type={field.kind === "date" ? "date" : "text"} maxLength={160} value={value} onChange={e => onChange(e.target.value)} />}</label>;
}

export function RecordEditor({ card, schema, save, cancel }: { card: RecordCard; schema: Schema; save: (card: RecordCard) => void; cancel: () => void }) {
  const [draft, setDraft] = useState(card);
  const [error, setError] = useState("");
  return <form className="tl-editor" onSubmit={e => {
    e.preventDefault(); const problem = recordProblem(draft.title, schema.fields, draft.values); setError(problem);
    if (!problem) save({ ...draft, title: draft.title.trim() });
  }}>
    <h2>Give this thought a shape</h2>
    <blockquote>{card.source.text}</blockquote>
    <label>Card title<input autoFocus required maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
    <div className="tl-fields">{schema.fields.map(field => <FieldInput key={field.id} field={field} value={draft.values[field.id] ?? ""}
      onChange={value => setDraft({ ...draft, values: { ...draft.values, [field.id]: value } })} />)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="tl-actions"><button type="submit" className="tl-primary">Keep card</button><button type="button" onClick={cancel}>Cancel</button></div>
  </form>;
}

export function SchemaEditor({ schema, save, cancel }: { schema: Schema; save: (schema: Schema) => void; cancel: () => void }) {
  const [draft, setDraft] = useState(() => structuredClone(schema));
  const [error, setError] = useState("");
  const patch = (id: string, change: Partial<Field>) => setDraft(previous => ({ ...previous, fields: previous.fields.map(field => field.id === id ? { ...field, ...change } : field) }));
  return <form className="tl-editor" onSubmit={e => {
    e.preventDefault();
    const next = { name: draft.name.trim(), fields: draft.fields.map(f => ({ ...f, name: f.name.trim(), options: f.options.map(o => o.trim()) })) };
    const problem = schemaProblem(next, schema); setError(problem); if (!problem) save(next);
  }}>
    <h2>Shape your list</h2>
    <p>Up to three fields. Existing types and options stay to keep every card intact.</p>
    <label>List name<input autoFocus required maxLength={40} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    {draft.fields.map(field => <fieldset key={field.id}><legend>{field.name || "New field"}</legend><div className="tl-fields">
      <label>Field name<input required maxLength={30} value={field.name} onChange={e => patch(field.id, { name: e.target.value })} /></label>
      <label>Field type<select value={field.kind} disabled={schema.fields.some(f => f.id === field.id)} onChange={e => patch(field.id, { kind: e.target.value as Field["kind"], options: e.target.value === "choice" ? ["Next", "Done"] : [] })}><option value="text">Short text</option><option value="date">Date</option><option value="choice">Choice</option></select></label>
      {field.kind === "choice" && <label>Options, separated by commas<input value={field.options.join(",")} onChange={e => patch(field.id, { options: e.target.value.split(",") })} /></label>}
    </div></fieldset>)}
    {draft.fields.length < 3 && <button type="button" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { id: crypto.randomUUID(), name: "", kind: "text", options: [] }] })}>Add field</button>}
    {error && <p role="alert">{error}</p>}
    <div className="tl-actions"><button className="tl-primary" type="submit">Keep list shape</button><button type="button" onClick={cancel}>Cancel</button></div>
  </form>;
}
