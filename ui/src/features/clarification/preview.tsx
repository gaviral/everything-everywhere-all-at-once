import { useState } from "react";
import { createRoot } from "react-dom/client";
import { clarification, ClarificationView, createClarification } from "./index";
import type { SelectedSource, SelectedSourceAdapter } from "./contracts";
import "./clarification.css";
import "./preview.css";

type Place = { top: number; start: number; end: number; pageY: number };
let snapshot: SelectedSource = { source: { id: "synthetic-thought", revision: "0", text: "" }, selection: null };
const listeners = new Set<() => void>();
const publish = (next: SelectedSource) => { snapshot = next; for (const listener of listeners) listener(); };
const editor = () => document.querySelector<HTMLTextAreaElement>("#thought")!;
const adapter: SelectedSourceAdapter<Place> = {
  getSnapshot: () => snapshot,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  capturePlace: () => ({ top: editor().scrollTop, start: snapshot.selection!.start, end: snapshot.selection!.end, pageY: window.scrollY }),
  restorePlace(place) {
    const field = editor();
    if (!field) return false;
    field.focus({ preventScroll: true });
    field.setSelectionRange(place.start, place.end);
    field.scrollTop = place.top;
    window.scrollTo(0, place.pageY);
    return true;
  },
};
const controller = createClarification(adapter);

function ThoughtEditor() {
  const [text, setText] = useState(snapshot.source.text);
  const [critical, setCritical] = useState(!!snapshot.critical);
  const select = (field: HTMLTextAreaElement) => {
    const start = field.selectionStart, end = field.selectionEnd;
    publish({ ...snapshot, selection: end > start ? { start, end, quote: field.value.slice(start, end) } : null });
  };
  return <div className="preview-editor">
    <label htmlFor="thought">Your thought</label>
    <textarea id="thought" value={text} placeholder="Write a synthetic paragraph, then select one term."
      onChange={(event) => {
        const text = event.target.value;
        setText(text);
        publish({ ...snapshot, source: { ...snapshot.source, revision: String(Number(snapshot.source.revision) + 1), text }, selection: null });
      }} onSelect={(event) => select(event.currentTarget)} />
    <label className="preview-critical"><input type="checkbox" checked={critical} onChange={(event) => { setCritical(event.target.checked); publish({ ...snapshot, critical: event.target.checked }); }} />This term affects a critical decision</label>
  </div>;
}

function Preview() {
  const [away, setAway] = useState(false);
  return <main>
    <p className="preview-label">Local preview · synthetic text only</p>
    <h1>Keep the words. Clarify the meaning.</h1>
    <p>Write a thought, select a term, and turn clarification on.</p>
    <button className="preview-visit" onClick={() => setAway(!away)}>{away ? "Return to thought" : "Leave thought"}</button>
    {away ? <p>Your thought is kept for this visit.</p> : <><ThoughtEditor /><ClarificationView controller={controller} /></>}
  </main>;
}

// Read-only metadata for preview checks; the production descriptor requires no global.
document.documentElement.dataset.defaultEnabled = String(clarification.defaultEnabled);
createRoot(document.getElementById("root")!).render(<Preview />);
