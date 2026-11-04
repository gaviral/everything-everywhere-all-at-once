import type { RefObject } from "react";
import type { Thought } from "../contract";

type Props = {
  choices: readonly Thought[]; selected: Thought | undefined; id: string; query: string; draftSource: string;
  connected: boolean; busy: boolean; button: RefObject<HTMLButtonElement | null>;
  onSelect: (id: string) => void; onQuery: (query: string) => void; onResearch: () => void; onCancel: () => void;
};

export function QuestionForm({ choices, selected, id, query, draftSource, connected, busy, button, onSelect, onQuery, onResearch, onCancel }: Props) {
  return <div className="question-research-form">
    <label>Question<select value={id} disabled={busy} onChange={e => onSelect(e.target.value)}>
      <option value="">Select a placed thought</option>{choices.map(t => <option key={t.id} value={t.id}>{[...t.text].slice(0,80).join("")}</option>)}
    </select></label>
    {id && <blockquote>{draftSource}</blockquote>}
    {id && (!selected || selected.text !== draftSource) && <p>Source changed or no longer on map. Select it again before researching.</p>}
    <label>Research query<textarea value={query} onChange={e => onQuery([...e.target.value].slice(0,400).join(""))} disabled={busy} /></label>
    <p className="question-research-scope">Sends this query and its topic title. Keeping an answer is a separate step.</p>
    <div className="question-research-actions"><button ref={button} type="button" disabled={busy || !connected || !selected || selected.text !== draftSource || !query.trim()} onClick={onResearch}>Research</button>
      {busy && <button type="button" onClick={onCancel}>Cancel</button>}</div>
  </div>;
}
