import { useLayoutEffect, useRef, useState } from "react";
import type { BrickActions, MapSnapshot, ResearchKept } from "../contract";
import { Evidence } from "./Evidence";
import { sourceState } from "./rules";

type Props = {
  map: MapSnapshot;
  actions: BrickActions;
  busy: boolean;
  opened: string;
  onOpen: (id: string) => void;
  onRemove: (answer: Readonly<ResearchKept>) => void;
};

function EvidenceReader({ answer, map, actions }: Pick<Props, "map" | "actions"> & { answer: Readonly<ResearchKept> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState("");
  const state = sourceState(answer, map.thoughts, map.threads);
  const source = map.thoughts.find(t => t.id === answer.thought_id);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  return <div className="question-research-reader" aria-label="Evidence beside original thought">
    <div className="question-research-original">
      <span className="question-research-eyebrow">Original thought</span>
      <blockquote>{answer.quote}</blockquote>
      <p>{answer.topic_title}</p>
      {state && <p className="question-research-source-state">{state}. Saved words stay with this answer.</p>}
      <button type="button" disabled={!source || state === "Source no longer on map"} onClick={() => {
        if (!actions.openThought(answer.thought_id)) setMessage("Original thought is unavailable. Your saved evidence is still here.");
        else setMessage(state ? "Current thought opened. Compare it with the saved words here." : "Original thought opened on the map.");
      }}>Show original thought</button>
      <p role="status">{message}</p>
    </div>
    <div className="question-research-attached">
      <h4 ref={heading} tabIndex={-1}>Attached answer</h4>
      <p className="question-research-query">Research query: {answer.query}</p>
      <Evidence answer={answer} />
    </div>
  </div>;
}

export function SavedEvidence({ map, actions, busy, opened, onOpen, onRemove }: Props) {
  const saved = (map.research ?? []).filter(r => !r.removed);
  return <details className="question-research-saved" open={saved.length > 0}>
    <summary>Kept evidence ({saved.length}/30)</summary>
    {saved.map(answer => <article key={answer.id} data-research-id={answer.id}>
      <div className="question-research-saved-title"><div>
        <span className="question-research-eyebrow">Attached to your question</span>
        <p>{answer.quote}</p>
        {sourceState(answer, map.thoughts, map.threads) && <small>{sourceState(answer, map.thoughts, map.threads)}</small>}
      </div><button type="button" aria-expanded={opened === answer.id} aria-controls={`research-reader-${answer.id}`} onClick={() => onOpen(opened === answer.id ? "" : answer.id)}>
        {opened === answer.id ? "Close evidence" : "Reopen evidence"}
      </button></div>
      {opened === answer.id && <div id={`research-reader-${answer.id}`}><EvidenceReader key={answer.id} answer={answer} map={map} actions={actions} /></div>}
      <button className="question-research-remove" type="button" disabled={busy || !map.connected} onClick={() => onRemove(answer)}>Remove answer</button>
    </article>)}
  </details>;
}
