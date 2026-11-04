import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { buildBrief } from "./rules";
import "./topic-brief.css";

export default function TopicBrief({ map, actions }: BrickProps) {
  const [open, setOpen] = useState(false);
  const [tangents, setTangents] = useState(false);
  const [receipt, setReceipt] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const preview = useRef<HTMLTextAreaElement>(null);
  const previous = useRef<{ source: string; text: string; updated: boolean } | null>(null);
  const source = useMemo(() => open ? buildBrief(map, tangents, 0) : null,
    [open, map.active, map.threads, map.thoughts, map.suggestions, map.reminders, map.speakers, tangents]);
  const brief = useMemo(() => {
    if (source === null) return null;
    if (previous.current?.source === source) return previous.current;
    return { source, text: source.replace("Generated at: 1970-01-01T00:00:00.000Z", `Generated at: ${new Date().toISOString()}`), updated: previous.current !== null };
  }, [source]);
  useLayoutEffect(() => { if (brief) { previous.current = brief; setReceipt(""); } }, [brief]);
  useLayoutEffect(() => { if (open) preview.current?.focus(); }, [open]);
  const close = () => { setOpen(false); opener.current?.focus(); };
  return <section className="topic-brief" aria-label="Topic brief" data-guide="topic-brief">
    <button ref={opener} className="topic-brief-trigger" type="button" aria-expanded={open} onClick={() => setOpen(true)}>Preview brief</button>
    {open && <form className="topic-brief-form" onSubmit={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="topic-brief-controls">
        <strong>Topic brief</strong>
        <button type="button" onClick={close}>Close brief</button>
      </div>
      <label className="topic-brief-scope"><input type="checkbox" checked={tangents} onChange={(event) => setTangents(event.target.checked)} /> Include tangents</label>
      {brief ? <>
        <label className="topic-brief-label" htmlFor="topic-brief-preview">Read-only Markdown preview</label>
        <textarea ref={preview} id="topic-brief-preview" className="topic-brief-preview" readOnly value={brief.text} />
        <p className="topic-brief-status" role="status">{receipt || (brief.updated ? "Updated from your map" : "Preview from your map")}</p>
        <button type="button" onClick={() => setReceipt(actions.saveTextFile("topic-brief.md", brief.text, "text/markdown") ? "Handed to browser; saving is up to you." : "Could not hand the file to the browser. Try Download again.")}>Download</button>
      </> : <p className="topic-brief-status">Choose an active topic on the map to preview its brief.</p>}
    </form>}
  </section>;
}
