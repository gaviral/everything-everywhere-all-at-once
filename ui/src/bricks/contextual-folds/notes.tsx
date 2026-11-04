import { useId, useState } from "react";
import { usePluginState, type BrickActions, type Thought } from "../contract";
import type { MarginNote } from "./content";
import type { Display } from "./controls";
import { Metadata } from "./metadata";

export function SourceNotes({ notes, display, isAI }: { notes: MarginNote[]; display: Display; isAI(name: string): boolean }) {
  if (!notes.length) return null;
  return <aside className="contextual-folds-notes" aria-label="Notes on these words">
    <p className="contextual-folds-label">Notes <span>{notes.reduce((sum, note) => sum + note.thoughts.length, 0)}</span></p>
    {notes.map(note => <details key={note.id} open className="contextual-folds-note">
      <summary>On “{note.quote}”</summary>
      {note.thoughts.map(thought => <div key={thought.id}>
        <p>{thought.text || thought.point}</p><Metadata thought={thought} display={display} ai={isAI(thought.speaker)} />
      </div>)}
    </details>)}
  </aside>;
}

/** Drafts survive a source jump. A question uses the existing anchored Notes path. */
export function ContextQuestion({ thought, example, connected, actions }: {
  thought: Thought; example: boolean; connected: boolean; actions: BrickActions;
}) {
  const [draft, setDraft] = usePluginState(`question:${example ? "example" : "map"}:${thought.id}`, "");
  const [examples, setExamples] = usePluginState<string[]>(`example-questions:${thought.id}`, []);
  const [status, setStatus] = useState("");
  const id = useId();
  const quote = thought.point || thought.text;
  return <details className="contextual-folds-question">
    <summary>Ask about these words</summary>
    <blockquote>{quote}</blockquote>
    {examples.map((question, i) => <p key={i} className="contextual-folds-local-question">Example question · {question}</p>)}
    <form onSubmit={event => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || text.length > 6000) return;
      if (example) { setExamples(old => [...old, text]); setStatus("Example question added in this browser only."); setDraft(""); }
      else if (connected && actions.annotate(thought.id, quote, text)) {
        setStatus("Question sent. It will appear in Notes when received."); setDraft("");
      } else setStatus("Question could not be sent. Your draft is here.");
    }}>
      <label htmlFor={id}>What would you like to clarify?</label>
      <textarea id={id} value={draft} maxLength={6000} rows={2} onChange={event => setDraft(event.target.value)} />
      {!connected && !example && <p>Disconnected · your draft stays here.</p>}
      <button type="submit" disabled={!draft.trim() || (!example && !connected)}>{example ? "Try an example question" : "Add question to Notes"}</button>
      <p className="contextual-folds-question-help">{example ? "Example only · kept in this browser." : "Shared on this map, attached to the quoted words."}</p>
      {status && <p role="status">{status}</p>}
    </form>
  </details>;
}
