import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { relatedThoughts } from "./rules";
import "./related-thoughts.css";

export default function RelatedThoughts({ map, actions }: BrickProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLElement>(null);
  const id = useId();
  const found = useMemo(() => relatedThoughts(map.threads, map.thoughts, map.active), [map.threads, map.thoughts, map.active]);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => { if (open) tray.current?.focus({ preventScroll: true }); }, [open]);
  // Capture only while open, so Escape cannot also dismiss or clear the person's current work.
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      setOpen(false); trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open]);
  return <div className="related-thoughts" data-guide="related-thoughts">
    <button ref={trigger} className="related-thoughts-trigger" type="button" aria-expanded={open} aria-controls={id}
      onClick={() => open ? close() : setOpen(true)}>Find related thoughts</button>
    {open && <section ref={tray} id={id} className="related-thoughts-tray" tabIndex={-1} aria-labelledby={`${id}-title`}>
      <div className="related-thoughts-top"><h2 id={`${id}-title`}>Possible connections</h2>
        <button type="button" onClick={close} aria-label="Close related thoughts">Close</button></div>
      <p className="related-thoughts-note">Matching words are a starting point, not an established connection.</p>
      {!found.selected ? <p role="status">Choose a topic first.</p> : <>
        {(found.topicCap || found.characterCap) && <p className="related-thoughts-coverage" role="status">Bounded coverage: {[
          found.topicCap ? "300 most recently touched topics" : "",
          found.characterCap ? "up to 4,000 characters per topic" : "",
        ].filter(Boolean).join("; ")}. Some earlier words were not checked.</p>}
        {!found.candidates.length && <p role="status">No possible connections in the checked topics.</p>}
        <ol className="related-thoughts-list">{found.candidates.map((candidate) => <li key={candidate.id} data-related-id={candidate.id}>
          <h3>{candidate.title}</h3>
          <p className="related-thoughts-meta">{candidate.speaker ?? "Speaker not recorded"} · <time dateTime={new Date(candidate.at).toISOString()}>{new Date(candidate.at).toLocaleString()}</time></p>
          <blockquote>{candidate.excerpt}</blockquote>
          <p className="related-thoughts-reason">{candidate.reason}</p>
          <div className="related-thoughts-tools">
            {candidate.original !== null && <button type="button" aria-expanded={expanded.has(candidate.id)} aria-controls={`${id}-${candidate.id}`}
              onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); return next; })}>Original words</button>}
            <button type="button" onClick={() => { close(); actions.openThread(candidate.id); }}>Open topic<span className="related-thoughts-sr">: {candidate.title}</span></button>
          </div>
          {expanded.has(candidate.id) && candidate.original !== null && <p className="related-thoughts-original" id={`${id}-${candidate.id}`}>{candidate.original}</p>}
        </li>)}</ol>
      </>}
    </section>}
  </div>;
}
