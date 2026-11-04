import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BrickProps } from "../contract";
import { Outline, outlineOf } from "./outline";
import "./work-list.css";

const PREFERENCES = "e2a2o.work-list.preferences";
function preferences(): { open: boolean; folded: number[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
    return { open: saved?.open === true, folded: Array.isArray(saved?.folded)
      ? saved.folded.filter((n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0) : [] };
  } catch { return { open: false, folded: [] }; }
}

/** Inject just this seam in checks; production reads only the File explicitly picked by the person.
 * Fatal decoding rejects other encodings. ignoreBOM retains a UTF-8 BOM in the complete source. */
export type TextLoader = (file: File) => Promise<string>;
export const loadLocalText: TextLoader = async (file) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());

export function WorkListPanel({ loadText = loadLocalText }: { loadText?: TextLoader }) {
  const [prefs] = useState(preferences);
  const [open, setOpen] = useState(prefs.open);
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set(prefs.folded));
  const [selected, setSelected] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [source, setSource] = useState(false);
  const [wrap, setWrap] = useState(true);
  const launcher = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLElement>(null);
  const readButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const id = useId();
  const rows = useMemo(() => outlineOf(selected?.text ?? ""), [selected]);
  useEffect(() => {
    try { localStorage.setItem(PREFERENCES, JSON.stringify({ open, folded: [...folded] })); } catch { /* memory still works */ }
  }, [open, folded]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (open) pane.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (reading) dialog.current?.showModal();
  }, [reading]);
  const toggle = (line: number) => setFolded((old) => {
    const next = new Set(old);
    if (!next.delete(line)) next.add(line);
    return next;
  });
  const close = () => { setOpen(false); launcher.current?.focus({ preventScroll: true }); };
  const finishReading = () => {
    dialog.current?.close();
    setReading(false);
    readButton.current?.focus({ preventScroll: true });
  };
  const choose = async (file: File) => {
    const version = ++generation.current;
    setError("");
    // Never label the previous snapshot with the new file's name, including on failed reads.
    setSelected(null);
    if (!/\.(md|txt)$/i.test(file.name)) { setError("Choose a UTF-8 .md or .txt file."); return; }
    setLoading(true);
    try {
      const text = await loadText(file);
      if (version === generation.current) setSelected({ name: file.name, text });
    } catch {
      if (version === generation.current) setError("Could not read this as UTF-8. Choose the file again.");
    } finally { if (version === generation.current) setLoading(false); }
  };
  const content = <>
    <p className="work-list-origin">{selected ? <>Source: <strong>{selected.name}</strong> · local file snapshot</> : "Choose the file again to read it here. No file access is kept after reload."}</p>
    <p className="work-list-help">Read only · stays local. Choose the file again to refresh.</p>
    {selected && (source ? <div className="work-list-source" tabIndex={0} aria-label="Complete source">{selected.text}</div>
      : <Outline rows={rows} folded={folded} toggle={toggle} />)}
  </>;
  const options = <div className="work-list-options">
    <label><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} /> Wrap lines</label>
    <label><input type="checkbox" checked={source} onChange={(event) => setSource(event.target.checked)} /> Complete source</label>
  </div>;
  return createPortal(<div className="work-list" data-guide="work-list">
    <button ref={launcher} type="button" className="work-list-launcher" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : setOpen(true)}>Work list</button>
    {open && <section ref={pane} id={id} className="work-list-panel" aria-label="Work list" tabIndex={-1}
      onKeyDown={(event) => { if (event.key === "Escape" && !reading) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="work-list-top"><h2>Work list</h2><button type="button" onClick={close} aria-label="Close Work list">Close</button></div>
      <label className="work-list-picker">{selected ? "Choose file again / refresh" : "Choose local file"}
        <input type="file" accept=".md,.txt,text/markdown,text/plain" disabled={loading} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // Selecting the same file again must fire a change.
          if (file) void choose(file);
        }} />
      </label>
      {loading && <p role="status">Reading local file…</p>}
      {error && <p role="alert">{error}</p>}
      {selected && <><button ref={readButton} className="work-list-read" type="button" onClick={() => setReading(true)}>Read here</button>{options}</>}
      <div className="work-list-body" data-wrap={wrap}>{content}</div>
    </section>}
    {reading && <dialog ref={dialog} className="work-list-reader" aria-label="Read Work list" onCancel={(event) => { event.preventDefault(); finishReading(); }}>
      <div className="work-list-top"><h2>Read here</h2><button autoFocus type="button" onClick={finishReading}>Back to Work list</button></div>
      {options}<div className="work-list-body" data-wrap={wrap}>{content}</div>
    </dialog>}
  </div>, document.body);
}

export default function WorkList(_props: BrickProps) { return <WorkListPanel />; }
