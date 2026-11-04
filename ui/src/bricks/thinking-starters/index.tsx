import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { BrickProps } from "../contract";
import { canPreview, emptyFields, FIELD_LIMIT, serialize, STARTERS, THOUGHT_LIMIT, type Fields, type StarterId } from "./rules";
import "./thinking-starters.css";

type Phase = "editing" | "preview" | "refused" | "submitted";
type Draft = { fields: Fields; phase: Phase };
const blank = (): Draft => ({ fields: emptyFields(), phase: "editing" });

export default function ThinkingStarters({ actions }: BrickProps) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<StarterId>("choice");
  const [drafts, setDrafts] = useState<Record<StarterId, Draft>>(() => ({ choice: blank(), update: blank(), unblock: blank() }));
  const opener = useRef<HTMLButtonElement>(null);
  const selector = useRef<HTMLSelectElement>(null);
  const preview = useRef<HTMLHeadingElement>(null);
  // Set before calling the synchronous host action. A second click cannot outrun React's render.
  const attempted = useRef(new Set<StarterId>());
  const retryReady = useRef(new Set<StarterId>());
  const starter = STARTERS.find((item) => item.id === id)!;
  const draft = drafts[id];
  const text = serialize(starter.labels, draft.fields);
  const valid = canPreview(starter.labels, draft.fields);

  useLayoutEffect(() => { if (open) selector.current?.focus(); }, [open]);
  useLayoutEffect(() => {
    if (draft.phase === "preview") preview.current?.focus();
    if (draft.phase === "refused") retryReady.current.add(id);
  }, [draft, id]);

  const patch = (next: Partial<Draft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...next } }));
  const close = () => { setOpen(false); opener.current?.focus(); };
  const send = (event: MouseEvent<HTMLButtonElement>, retry = false) => {
    // A real double-click's second click must not turn a refusal into an implicit retry.
    if (event.detail > 1 || !valid || draft.phase === "submitted") return;
    if (retry && draft.phase === "refused") {
      if (!retryReady.current.delete(id)) return;
      attempted.current.delete(id);
    }
    if (attempted.current.has(id)) return;
    attempted.current.add(id);
    let accepted = false;
    try { accepted = actions.addThought(text); } catch { /* Same refusal UI; the person's fields stay here. */ }
    patch({ phase: accepted ? "submitted" : "refused" });
  };

  return <section className="thinking-starters" aria-label="Thinking starters" data-guide="thinking-starters"
    onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="thinking-starters-top">
      <button type="button" ref={opener} aria-expanded={open} aria-controls="thinking-starters-body"
        onClick={() => { if (open) close(); else setOpen(true); }}>Thinking starters</button>
      {open && <button type="button" onClick={close}>Close</button>}
    </div>
    {open && <div id="thinking-starters-body" className="thinking-starters-body">
      <p className="thinking-starters-note">Unsent edits last while this feature is on.</p>
      <label className="thinking-starters-label" htmlFor="thinking-starters-select">Choose a starter</label>
      <select id="thinking-starters-select" ref={selector} value={id} onChange={(event) => setId(event.target.value as StarterId)}>
        {STARTERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {draft.phase === "editing" ? <form onSubmit={(event) => { event.preventDefault(); if (valid) patch({ phase: "preview" }); }}>
        <p className="thinking-starters-note" id="thinking-starters-help">Write in your own words. Fill the first field and at least one other to preview. Nothing is sent yet.</p>
        {starter.labels.map((label, i) => <div className="thinking-starters-field" key={`${id}-${i}`}>
          <label className="thinking-starters-label" htmlFor={`thinking-starters-field-${i}`}>{label}{i === 0 ? " (required)" : ""}</label>
          <textarea id={`thinking-starters-field-${i}`} value={draft.fields[i]} rows={2} maxLength={FIELD_LIMIT} required={i === 0}
            aria-describedby={`thinking-starters-help thinking-starters-count-${i}`}
            onChange={(event) => {
              const fields: Fields = [...draft.fields];
              fields[i] = event.target.value.slice(0, FIELD_LIMIT);
              attempted.current.delete(id);
              patch({ fields });
            }} />
          <span className="thinking-starters-note" id={`thinking-starters-count-${i}`}>{draft.fields[i].length} / {FIELD_LIMIT}</span>
        </div>)}
        <div className="thinking-starters-actions"><button type="submit" disabled={!valid}>Preview</button>
          <span className="thinking-starters-note">{text.length} / {THOUGHT_LIMIT} total characters</span></div>
      </form> : <div>
        <h3 className="thinking-starters-heading" tabIndex={-1} ref={preview}>Thought preview</h3>
        <p className="thinking-starters-note">Exactly the text sent as one thought:</p>
        <pre className="thinking-starters-preview">{text}</pre>
        {draft.phase === "submitted" ? <p className="thinking-starters-status" role="status">Submitted to E2A2O</p>
          : draft.phase === "refused" ? <p className="thinking-starters-status" role="status">Not submitted. Your fields are kept. Retry when ready.</p> : null}
        <div className="thinking-starters-actions">
          {draft.phase === "preview" && <button type="button" onClick={(event) => send(event)}>Send as thought</button>}
          {draft.phase === "refused" && <button type="button" onClick={(event) => send(event, true)}>Retry</button>}
          {draft.phase !== "submitted" && <button type="button" onClick={() => { attempted.current.delete(id); patch({ phase: "editing" }); }}>Edit fields</button>}
          {draft.phase === "submitted" && <button type="button" onClick={() => { attempted.current.delete(id); setDrafts((current) => ({ ...current, [id]: blank() })); }}>Start another thought</button>}
        </div>
      </div>}
    </div>}
  </section>;
}
