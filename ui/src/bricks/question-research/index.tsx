import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrickProps, ResearchCommand, ResearchKept } from "../contract";
import { answerParts, sourceState } from "./rules";
import "./question-research.css";

export default function QuestionResearch({ map, actions }: BrickProps) {
  const choices = map.thoughts.filter(t => t.placed && t.text.trim() && map.threads.some(th => th.id === t.thread_id));
  const [id, setId] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ResearchKept | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<ResearchCommand | null>(null);
  const [draftSource, setDraftSource] = useState("");
  const [undo, setUndo] = useState<ResearchKept | null>(null);
  const researchButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const returnToResearch = useRef(false);
  useLayoutEffect(() => { if (!busy && returnToResearch.current) { returnToResearch.current = false; researchButton.current?.focus(); } }, [busy]);
  useLayoutEffect(() => { if (undo) undoButton.current?.focus(); }, [undo]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const selected = choices.find(t => t.id === id);
  const saved = (map.research ?? []).filter(r => !r.removed);
  const removed = (map.research ?? []).filter(r => r.removed);
  const command = async (request: ResearchCommand) => {
    const epoch = ++generation.current;
    setBusy(true); setMessage(request.op === "run" ? "Researching…" : "Saving…");
    const result = await actions.research(request);
    if (epoch !== generation.current) return;
    setBusy(false); setMessage(result.message);
    if (result.ok && result.answer) {
      setRetry(null);
      if (request.op === "run") setPreview(result.answer);
      else if (request.op === "keep") { returnToResearch.current = true; setPreview(null); }
      else if (request.op === "remove") setUndo(result.answer);
      else { returnToResearch.current = true; setUndo(null); }
    } else if (request.op !== "run") setRetry(request);
  };
  const cancel = () => { returnToResearch.current = true; generation.current++; actions.cancelResearch(); setBusy(false); setPreview(null); setMessage("Research cancelled. Your query is kept."); };
  return <section className="question-research" aria-label="Research this question">
    <h3>Research this question</h3>
    <label>Question<select value={id} disabled={busy} onChange={e => {
      const thought = choices.find(t => t.id === e.target.value);
      setId(e.target.value); setQuery([...thought?.text ?? ""].slice(0,400).join("")); setDraftSource(thought?.text ?? ""); setPreview(null); setRetry(null); setMessage("");
    }}><option value="">Select a placed thought</option>{choices.map(t => <option key={t.id} value={t.id}>{[...t.text].slice(0,80).join("")}</option>)}</select></label>
    {id && <blockquote>{draftSource}</blockquote>}
    {id && (!selected || selected.text !== draftSource) && <p>Source changed or no longer on map. Select it again before researching.</p>}
    <label>Research query<textarea value={query} maxLength={400} onChange={e => { setQuery(e.target.value); setPreview(null); }} disabled={busy} /></label>
    <p className="question-research-scope">Sends this query and its topic title. Keeping an answer is a separate step.</p>
    <div className="question-research-actions"><button ref={researchButton} type="button" disabled={busy || !map.connected || !selected || selected.text !== draftSource || !query.trim()} onClick={() => {
      setPreview(null); void command({ request_id: crypto.randomUUID(), op: "run", thought_id: id, quote: draftSource, query });
    }}>Research</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
    <p role="status">{message}</p>
    {preview && <div className="question-research-preview"><Evidence answer={preview} />
      <button type="button" disabled={busy} onClick={() => void command({request_id: crypto.randomUUID(), op:"keep",answer_id:preview.id})}>Keep answer</button>
    </div>}
    {retry && <button type="button" disabled={busy} onClick={() => void command(retry)}>Retry save explicitly</button>}
    <details open={saved.length > 0}><summary>Kept evidence ({saved.length}/30)</summary>{saved.map(answer => <article key={answer.id}>
      <blockquote>{answer.quote}</blockquote><p>{sourceState(answer,map.thoughts,map.threads)}</p><Evidence answer={answer} />
      <button type="button" disabled={busy} onClick={() => void command({request_id:crypto.randomUUID(),op:"remove",answer_id:answer.id,revision:answer.revision})}>Remove answer</button>
    </article>)}</details>
    {removed.length > 0 && <details open><summary>Removed evidence ({removed.length})</summary>{removed.map(answer => <article key={answer.id}>
      <blockquote>{answer.quote}</blockquote><p>{answer.topic_title}</p>
      <button ref={undo?.id === answer.id ? undoButton : undefined} type="button" disabled={busy} onClick={() => void command({request_id:crypto.randomUUID(),op:"undo",answer_id:answer.id,revision:answer.revision})}>Undo removal</button>
    </article>)}</details>}
  </section>;
}
function Evidence({ answer }: { answer: Readonly<ResearchKept> }) {
  return <div className="question-research-evidence">{answer.simulated && <strong className="question-research-simulated">Simulated research</strong>}
    <p>{answerParts(answer.answer,answer.citations).map(part => <span key={part.start} data-supported={part.supported}>{part.text}{part.citations.map((c,i) => <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Source: ${c.title}`}> [{c.title}]</a>)}</span>)}</p>
    <ul>{answer.citations.map((c,i) => <li key={i}>{c.title}</li>)}</ul>
    <small>{answer.model} · {new Date(answer.at_ms).toLocaleString()}</small>
  </div>;
}
