import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { decodeLayout, DRAFT_LIMIT, emptyLayout, layoutKey, NOTE_LIMIT, pin, refresh, type Layout } from "./rules";
import "./sticky-notes.css";

/** The existing handshake caches this opaque identity before the map's snapshot. No journal or connector reads. */
function scopeFor(map: BrickProps["map"]): string | null {
  if (location.pathname.endsWith("/bricks.html")) {
    return layoutKey(`playground:${new URLSearchParams(location.search).get("sample") ?? "empty"}`, map.me);
  }
  return map.connected && map.mapIdentity ? layoutKey(map.mapIdentity, map.me) : null;
}

export default function StickyNotes(props: BrickProps) {
  const scope = scopeFor(props.map);
  return scope ? <LocalNotes key={scope} {...props} scope={scope} />
    : <section className="sticky-notes" aria-label="Sticky notes"><strong>Sticky notes · Local layout</strong><p>Waiting for this map to identify itself. Retained notes stay in this tab.</p></section>;
}

function LocalNotes({ map, actions, scope }: BrickProps & { scope: string }) {
  const [loaded] = useState(() => {
    try { const value = decodeLayout(sessionStorage.getItem(scope)); return { value: value ?? emptyLayout(), writable: value !== null }; }
    catch { return { value: emptyLayout(), writable: false }; }
  });
  const [layout, setLayout] = useState(loaded.value);
  const current = useRef(layout);
  const [status, setStatus] = useState(loaded.writable ? "" : "Saved layout unavailable. Existing storage is retained; new edits last only while enabled.");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const id = useId();
  // Save each intentional edit synchronously: an immediate switch-off or reload cannot beat an effect.
  const keep = (next: Layout) => {
    current.current = next;
    setLayout(next);
    if (!loaded.writable) return;
    try { sessionStorage.setItem(scope, JSON.stringify(next)); setStatus(""); }
    catch { setStatus("Could not save in this tab. Keep this feature open to retain new edits."); }
  };
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const next = refresh(current.current, map.thoughts, map.threads);
    if (next !== current.current) keep(next);
  }, [map.thoughts, map.threads]);
  useLayoutEffect(() => { if (open) picker.current?.focus({ preventScroll: true }); }, [open]);
  // This is the only listener, owned by the open form. Off/close removes it; there are no async results to accept.
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Element) || !event.target.closest(".sticky-notes")) return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open]);
  const pinned = new Set(layout.references.map(reference => reference.id));
  const choices = map.thoughts.filter(thought => !pinned.has(thought.id));
  const choice = choices.find(thought => thought.id === selected);
  return <section className="sticky-notes" aria-label="Sticky notes" data-guide="sticky-notes">
    <button ref={trigger} type="button" className="sticky-notes-trigger" aria-expanded={open} aria-controls={id}
      onClick={() => open ? close() : setOpen(true)}>Sticky notes · {layout.references.length}/{NOTE_LIMIT}</button>
    <span className="sticky-notes-local">Local layout · this tab</span>
    {open && <div id={id} className="sticky-notes-form">
      <div className="sticky-notes-top"><strong>Sticky notes</strong><button type="button" onClick={close}>Close notes</button></div>
      <form className="sticky-notes-pin" onSubmit={event => {
        event.preventDefault();
        if (choice) { keep(pin(current.current, choice, map.threads)); setSelected(""); picker.current?.focus(); }
      }}>
        <label htmlFor={`${id}-source`}>Source thought</label>
        <select ref={picker} id={`${id}-source`} value={choice?.id ?? ""} onChange={event => setSelected(event.target.value)}>
          <option value="">{choices.length ? "Choose an existing thought" : "No unpinned thoughts on this map"}</option>
          {choices.map(thought => <option key={thought.id} value={thought.id}>{thought.speaker} · {thought.id} · {thought.text.slice(0, 100)}</option>)}
        </select>
        <button type="submit" disabled={!choice || layout.references.length >= NOTE_LIMIT}>Pin thought</button>
      </form>
      {layout.references.length >= NOTE_LIMIT && <p>All twelve places are used. Remove a reference to free a place.</p>}
      <ol className="sticky-notes-grid">{layout.references.map((reference, index) => {
        const source = map.thoughts.find(thought => thought.id === reference.id);
        const topic = source ? map.threads.find(thread => thread.id === source.thread_id)?.title ?? "Unplaced thought" : reference.topic;
        return <li className="sticky-notes-note" key={reference.id} data-sticky-id={reference.id}>
          <strong>{topic}</strong><p className="sticky-notes-meta">{source?.speaker ?? reference.speaker} · Source {reference.id}</p>
          {!source && <p className="sticky-notes-missing">Source no longer on map · retained historical quote</p>}
          <blockquote>{source ? source.text : reference.quote}</blockquote>
          <div className="sticky-notes-tools">
            <button type="button" disabled={!source?.placed || !source.thread_id} onClick={() => actions.openThought(reference.id)}>Open source</button>
            <button type="button" aria-label={`Remove reference ${reference.id}`} onClick={() => keep({ ...current.current, references: current.current.references.filter(row => row.id !== reference.id) })}>Remove reference</button>
            <button type="button" disabled={index === 0} aria-label={`Move reference ${reference.id} earlier`} onClick={() => {
              const references = [...current.current.references];
              [references[index - 1], references[index]] = [references[index], references[index - 1]];
              keep({ ...current.current, references });
            }}>Move earlier</button>
          </div>
        </li>;
      })}</ol>
      {!layout.references.length && <p>Pin a source thought to keep its original words at hand.</p>}
      <label htmlFor={`${id}-draft`}>Unsent scratch draft</label>
      <textarea className="sticky-notes-draft" id={`${id}-draft`} value={layout.draft} maxLength={DRAFT_LIMIT}
        onChange={event => keep({ ...current.current, draft: event.target.value })} aria-describedby={`${id}-pending`} />
      <p id={`${id}-pending`} className="sticky-notes-pending">Adding to a topic is pending. This draft stays in this tab and never changes accepted speech.</p>
      <p className="sticky-notes-status" role="status">{status || "Layout and draft stay for reloads in this tab, including while switched off."}</p>
    </div>}
  </section>;
}
