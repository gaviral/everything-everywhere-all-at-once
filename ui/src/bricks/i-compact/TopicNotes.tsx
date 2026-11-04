import { useState } from "react";
import { headingId, type ReadingTopic, type TopicNotes as Notes } from "./model";

export function TopicNotes({ topic, revision, notes, update, connected }: {
  topic: ReadingTopic; revision: string; notes: Notes; update(next: Notes): void; connected: boolean;
}) {
  const [question, setQuestion] = useState("");
  const stale = !!notes.synthesis && notes.synthesis.revision !== revision;
  const canReview = connected && topic.sources.length > 0 && !!notes.synthesis?.text.trim();
  return <aside className="i-compact-notes" aria-label={`Notes for ${topic.title}`}>
    <div className="i-compact-synthesis">
      <p className="i-compact-eyebrow">Your synthesis</p>
      <h3>What you take from this</h3>
      <p>Editable interpretation, separate from the source points. Kept in this browser visit.</p>
      <label>Write your synthesis
        <textarea rows={4} maxLength={6000} value={notes.synthesis?.text ?? ""}
          placeholder="For example: test repeat borrowing, but wait for the permit."
          onChange={event => update({ ...notes, synthesis: {
            text: event.target.value, revision: notes.synthesis?.revision ?? revision,
          } })} />
      </label>
      <p className={stale ? "i-compact-warning" : "i-compact-meta"} role="status">{stale
        ? "Source changed · synthesis invalidated. Review the originals before marking it reviewed."
        : notes.synthesis ? "Personal interpretation · bound to the source wording shown here; not verified."
        : "Source points and originals remain unchanged as you write."}</p>
      {stale && <button type="button" disabled={!canReview}
        onClick={() => update({ ...notes, synthesis: { text: notes.synthesis!.text, revision } })}>
        I reviewed the current originals
      </button>}
    </div>
    <form className="i-compact-questions" onSubmit={event => {
      event.preventDefault();
      if (!question.trim()) return;
      update({ ...notes, questions: [...notes.questions, {
        id: crypto.randomUUID(), text: question.trim(), heading: headingId(topic.id), revision,
      }] });
      setQuestion("");
    }}>
      <h3>Questions for this topic</h3>
      <label>Ask a question here<input maxLength={1000} value={question}
        placeholder="What would change our decision?" onChange={event => setQuestion(event.target.value)} /></label>
      <button type="submit" disabled={!question.trim()}>Record question</button>
      <p className="i-compact-meta">Local notes · no AI answer is requested.</p>
      <ul>{notes.questions.map(item => <li key={item.id}>
        <p>{item.text}</p><a href={`#${item.heading}`}>This topic · {item.heading}</a>
        {item.revision !== revision && <p className="i-compact-warning">Source changed since this question.</p>}
      </li>)}</ul>
    </form>
  </aside>;
}
