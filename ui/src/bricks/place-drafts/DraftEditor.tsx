import { useEffect, useLayoutEffect, useRef } from "react";
import type { Draft, Quote } from "./checkpoint";

export function DraftEditor({ documentId, draft, quote, change }: {
  documentId: string; draft: Draft; quote?: Quote; change(value: Draft): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const current = useRef(draft);
  current.current = draft;
  const restore = (element: HTMLTextAreaElement) => {
    const saved = current.current;
    element.setSelectionRange(saved.start, saved.end, saved.direction);
    element.scrollTop = saved.scroll;
  };
  useLayoutEffect(() => { if (field.current) restore(field.current); }, [documentId]);
  const capture = (element: HTMLTextAreaElement) => {
    const selectingSource = !!window.getSelection()?.anchorNode?.parentElement?.closest("[data-reading-words]");
    // Selecting source text can reset a focused textarea's native range. Keep its last editing range.
    const retainRange = selectingSource && element.value === current.current.text;
    const next = { text: element.value, start: retainRange ? current.current.start : element.selectionStart,
      end: retainRange ? current.current.end : element.selectionEnd,
      direction: retainRange ? current.current.direction : element.selectionDirection, scroll: element.scrollTop };
    if (JSON.stringify(next) !== JSON.stringify(current.current)) change(next);
  };
  const captureNow = useRef(capture);
  captureNow.current = capture;
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    const selected = () => captureNow.current(element);
    const selectionChanged = () => { if (document.activeElement === element) selected(); };
    // A native selection can change without React's synthetic onSelect (including range restoration).
    element.addEventListener("select", selected);
    document.addEventListener("selectionchange", selectionChanged);
    return () => {
      element.removeEventListener("select", selected);
      document.removeEventListener("selectionchange", selectionChanged);
    };
  }, []);
  return <aside className="place-drafts-note">
    <p className="place-drafts-eyebrow">Your interrupted thought</p>
    <h2>A place to leave it.</h2>
    <p>Unsent · kept for this map and person in this tab, including after refresh.</p>
    {quote && <blockquote><span>Earlier source selection</span>{quote.text}</blockquote>}
    <label htmlFor="place-drafts-editor">Draft for this reading</label>
    <textarea id="place-drafts-editor" ref={field} value={draft.text} rows={8}
      placeholder="What were you about to say?" onFocus={event => restore(event.currentTarget)}
      onChange={event => capture(event.currentTarget)} onSelect={event => capture(event.currentTarget)}
      onBlur={event => capture(event.currentTarget)}
      onScroll={event => capture(event.currentTarget)} />
    <p className="place-drafts-small">Typing stays here. Source links open the original; return to Keep my place to continue. Nothing is submitted or approved.</p>
  </aside>;
}
