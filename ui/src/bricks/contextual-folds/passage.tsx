import type { BrickActions } from "../contract";
import type { Passage } from "./content";
import type { Display } from "./controls";
import { Metadata } from "./metadata";
import { ContextQuestion, SourceNotes } from "./notes";

export type ReadingContext = {
  display: Display; example: boolean; connected: boolean; actions: BrickActions; isAI(name: string): boolean;
};

export function ReadingPassage({ passage, context }: { passage: Passage; context: ReadingContext }) {
  const { thought, notes } = passage;
  const { display, example, connected, actions, isAI } = context;
  return <div className={`contextual-folds-passage${notes.length ? " contextual-folds-with-notes" : ""}`} data-source={thought.id}>
    <article className="contextual-folds-words">
      <Metadata thought={thought} display={display} ai={isAI(thought.speaker)} />
      <p className="contextual-folds-prose">{thought.text || thought.point}</p>
      {thought.unclear && <p className="contextual-folds-unclear">Unclear in source: {thought.unclear}</p>}
      <div className="contextual-folds-source-actions">
        <ContextQuestion thought={thought} example={example} connected={connected} actions={actions} />
        {!example && <button type="button" onClick={() => actions.openThought({ id: thought.id, text: thought.text,
          threadId: thought.thread_id!, at: thought.at_ms, speaker: thought.speaker })}>Open source ↗</button>}
      </div>
    </article>
    <SourceNotes notes={notes} display={display} isAI={isAI} />
  </div>;
}
