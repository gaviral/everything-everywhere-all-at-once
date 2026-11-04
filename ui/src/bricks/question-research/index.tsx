import { useState } from "react";
import type { BrickProps } from "../contract";
import { Evidence } from "./Evidence";
import { ExampleEvidence } from "./ExampleEvidence";
import { QuestionForm } from "./QuestionForm";
import { SavedEvidence } from "./SavedEvidence";
import { useResearch } from "./useResearch";
import "./question-research.css";

export default function QuestionResearch(props: BrickProps) {
  return <ResearchWorkspace key={props.map.visitKey ?? `${props.map.mapIdentity ?? "map"}:${props.map.me}`} {...props} />;
}

function ResearchWorkspace({ map, actions }: BrickProps) {
  const choices = map.thoughts.filter(t => t.placed && t.text.trim() && map.threads.some(th => th.id === t.thread_id));
  const first = choices.find(t => t.speaker === map.me && t.text.includes("?")) ?? choices[0];
  const [id, setId] = useState(first?.id ?? "");
  const [query, setQuery] = useState([...(first?.text ?? "")].slice(0, 400).join(""));
  const [draftSource, setDraftSource] = useState(first?.text ?? "");
  const research = useResearch(actions);
  const selected = choices.find(t => t.id === id);
  const removed = (map.research ?? []).filter(r => r.removed);
  return <section className="question-research" aria-label="Research this question" onKeyDown={e => {
    if (e.key === "Escape" && research.busy) { e.stopPropagation(); research.cancel(); }
  }}>
    <div className="question-research-intro"><span className="question-research-eyebrow">From question to evidence</span>
      <h3>Research this question</h3><p>A cited answer, kept beside the thought that started it.</p></div>
    {!choices.length && !(map.research ?? []).some(r => !r.removed) && <ExampleEvidence />}
    <QuestionForm choices={choices} selected={selected} id={id} query={query} draftSource={draftSource}
      connected={map.connected} busy={research.busy} button={research.researchButton} onCancel={research.cancel}
      onSelect={value => {
        const thought = choices.find(t => t.id === value);
        setId(value); setQuery([...(thought?.text ?? "")].slice(0, 400).join("")); setDraftSource(thought?.text ?? ""); research.clearPreview();
      }} onQuery={value => { setQuery(value); research.clearPreview(); }} onResearch={() => {
        research.clearPreview(); void research.command({ request_id: crypto.randomUUID(), op: "run", thought_id: id, quote: draftSource, query });
      }} />
    <p role="status">{research.message || (!map.connected ? "Offline. Kept evidence is still readable; your query stays here." : "Research starts only when you choose Research.")}</p>
    {research.preview && <div className="question-research-preview"><span className="question-research-eyebrow">Answer preview · not yet attached</span><Evidence answer={research.preview} />
      <button type="button" disabled={research.busy || !map.connected} onClick={() => void research.command({request_id: crypto.randomUUID(), op:"keep",answer_id:research.preview!.id})}>Keep answer</button>
    </div>}
    {research.retry && <button type="button" disabled={research.busy || !map.connected} onClick={() => void research.command(research.retry!)}>Retry save explicitly</button>}
    <SavedEvidence map={map} actions={actions} busy={research.busy} opened={research.opened} onOpen={research.setOpened}
      onRemove={answer => void research.command({request_id:crypto.randomUUID(),op:"remove",answer_id:answer.id,revision:answer.revision})} />
    {removed.length > 0 && <details open><summary>Removed evidence ({removed.length})</summary>{removed.map(answer => <article key={answer.id}>
      <blockquote>{answer.quote}</blockquote><p>{answer.topic_title}</p>
      <button ref={research.undo?.id === answer.id ? research.undoButton : undefined} type="button" disabled={research.busy || !map.connected} onClick={() => void research.command({request_id:crypto.randomUUID(),op:"undo",answer_id:answer.id,revision:answer.revision})}>Undo removal</button>
    </article>)}</details>}
  </section>;
}
