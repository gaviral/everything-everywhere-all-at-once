import { useId, useRef, useLayoutEffect } from "react";
import { WORD_LIMIT, wordError, type Draft } from "./review";

export function PasteWords({ value, change, review }: { value: string; change: (text: string) => void; review: () => void }) {
  const id = useId();
  return <form className="speech-review-paste" onSubmit={event => { event.preventDefault(); if (!wordError(value)) review(); }}>
    <label htmlFor={id}>Paste recognized words</label>
    <textarea id={id} rows={3} value={value} onChange={event => change(event.target.value)} placeholder="Paste a transcript to catch names and misheard words…" />
    <p className="speech-review-note">{value && wordError(value) || "Words stay here until you review and release them."}</p>
    <button type="submit" disabled={!!wordError(value)}>Review these words →</button>
  </form>;
}

export function OriginalWords({ draft }: { draft: Draft }) {
  return <details className="speech-review-original"><summary>Original recognized words</summary><p>{draft.original}</p></details>;
}

export function WordEditor({ draft, change, preview }: { draft: Draft; change: (text: string) => void; preview: () => void }) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { field.current?.focus({ preventScroll: true }); }, []);
  const error = wordError(draft.text);
  return <form onSubmit={event => { event.preventDefault(); if (!error) preview(); }}>
    <label htmlFor={id}>What you meant</label>
    <textarea ref={field} id={id} rows={3} value={draft.text} aria-describedby={`${id}-help`} onChange={event => change(event.target.value)} />
    <p id={`${id}-help`} className="speech-review-note">{error || `${Array.from(draft.text).length.toLocaleString()} / ${WORD_LIMIT.toLocaleString()} · Enter adds a line`}</p>
    <button className="speech-review-primary" type="submit" disabled={!!error}>Preview release →</button>
  </form>;
}

export function ReleasePreview({ draft, connected, release, edit }: { draft: Draft; connected: boolean; release: (repeat: boolean) => void; edit: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const sent = draft.phase === "submitted";
  return <div className="speech-review-preview">
    <h3 ref={heading} tabIndex={-1}>Ready for the map</h3>
    <p className="speech-review-exact">{draft.text}</p>
    <p className="speech-review-note">Released as a typed thought, using ordinary command interpretation.</p>
    <p role="status" className="speech-review-status">{sent ? "Submitted to E2A2O · placement and saving follow the app’s status." : draft.phase === "refused" ? "Not submitted. Your words remain here. Retry explicitly when ready." : !connected ? "Disconnected. Your words remain here; release when reconnected." : "Nothing sent yet. Only these reviewed words will be submitted."}</p>
    <div className="speech-review-actions">
      {!sent && <button className="speech-review-primary" type="button" disabled={!connected} onClick={event => { if (event.detail < 2) release(draft.phase === "refused"); }}>{draft.phase === "refused" ? "Retry release" : draft.example ? "Release example to map ↗" : "Release to map ↗"}</button>}
      {!sent && <button type="button" onClick={edit}>Edit words</button>}
    </div>
  </div>;
}
