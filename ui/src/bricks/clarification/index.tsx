import { useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { ClarificationView, createClarification } from "../../msg1351/clarification";
import type { SelectedSource, SelectedSourceAdapter } from "../../msg1351/clarification/contracts";
import "../../msg1351/clarification/clarification.css";
import "./example.css";

function useExampleSource() {
  const editor = useRef<HTMLTextAreaElement>(null);
  const [example] = useState(() => {
    const text = "Keep the original thought while we clarify what a handoff means.";
    const start = text.indexOf("handoff");
    let snapshot: SelectedSource = { source: { id: "example-thought", revision: "1", text }, selection: { start, end: start + 7, quote: "handoff" } };
    const listeners = new Set<() => void>();
    const publish = (next: SelectedSource) => { snapshot = next; listeners.forEach(listener => listener()); };
    const adapter: SelectedSourceAdapter<{ start: number; end: number }> = {
      getSnapshot: () => snapshot,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      capturePlace: () => ({ start: snapshot.selection!.start, end: snapshot.selection!.end }),
      restorePlace: place => { if (!editor.current) return false; editor.current.focus(); editor.current.setSelectionRange(place.start, place.end); return true; },
    };
    const controller = createClarification(adapter);
    controller.setEnabled(true);
    controller.ask();
    return { controller, publish, text };
  });
  return { editor, example };
}
export default function ClarificationExample({ actions }: BrickProps) {
  const { editor, example } = useExampleSource();
  const [text, setText] = useState(example.text);
  return <section className="clarification-example" aria-label="Clarification example" data-guide="clarification">
    <div><strong>Clarification · local example</strong><button onClick={() => actions.openCatalog("clarification")}>Features</button></div>
    <p>The example selects “handoff”. Select any other words to ask about them.</p>
    <label>Example thought<textarea ref={editor} value={text} onChange={event => {
      setText(event.target.value); example.publish({ source: { id: "example-thought", revision: event.target.value, text: event.target.value }, selection: null });
    }} onSelect={event => { const field = event.currentTarget; example.publish({ source: { id: "example-thought", revision: text === example.text ? "1" : text, text }, selection: field.selectionEnd > field.selectionStart ? { start: field.selectionStart, end: field.selectionEnd, quote: text.slice(field.selectionStart, field.selectionEnd) } : null }); }} /></label>
    <ClarificationView controller={example.controller} />
  </section>;
}
