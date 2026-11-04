import { useEffect, useRef, useState } from "react";
import type { BrickProps, Question, QuestionInput, QuestionResult } from "../contract";
import { latestThought, problem } from "./rules";
import "./saved-questions.css";

export default function SavedQuestions({ map, actions }: BrickProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const [text, setText] = useState("");
  const [link, setLink] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [editText, setEditText] = useState("");
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState<QuestionInput | null>(null);
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const opener = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const capture = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (editing) editor.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!pending || !result) return;
    if (!result.ok) { setMessage(result.error ?? "Could not save. Review the current record."); setPending(null); return; }
    const saved = map.questions.find(q => q.id === pending.id && q.revision === result.revision && q.question === pending.text && q.answer === pending.answer && q.status === pending.status && q.thought_id === pending.thought_id);
    if (!saved) return;
    setMessage("Saved");
    setPending(null);
    setEditing(null);
    if (pending.expected_revision === 0) { setText(""); setLink(false); }
    if (pending.status !== "archived") setTab(pending.status);
    capture.current?.focus();
  }, [pending, result, map.questions]);

  const close = () => { setOpen(false); opener.current?.focus(); };
  const edit = (q: Question) => { setEditing(q); setEditText(q.question); setAnswer(q.answer); setMessage(""); };
  const save = (input: QuestionInput) => {
    if (pending) return;
    const error = problem(input);
    if (error) { setMessage(error); return; }
    if (!map.connected) { setMessage("Not connected. Nothing was sent."); return; }
    setResult(null);
    setPending(input);
    setMessage("Saving…");
    if (!actions.saveQuestion(input, reply => { if (alive.current) setResult(reply); })) {
      setPending(null); setMessage("Could not queue the save. Nothing was sent. Try when connected.");
    }
  };
  const update = (q: Question, status: Question["status"]) => save({ id: q.id, text: q.question, thought_id: q.thought_id, answer: q.answer, status, expected_revision: q.revision });
  const rows = (questions: readonly Question[]) => questions.map(q => <li className="saved-questions-row" key={q.id} data-question-id={q.id} data-revision={q.revision}>
    <p>{q.question}</p>
    <small>{q.status === "answered" ? "Answered by you" : q.status === "archived" ? "Archived by you" : "Open · saved by you"}</small>
    {q.answer && <p className="saved-questions-answer">{q.answer}</p>}
    {q.thought_id && <small>{map.thoughts.some(t => t.id === q.thought_id && t.placed && map.threads.some(thread => thread.id === t.thread_id)) ? "Linked to a thought on this map" : "Source no longer on map"}</small>}
    <div className="saved-questions-tools">
      {q.status !== "archived" && <button type="button" disabled={!!pending} onClick={() => edit(q)}>{q.status === "open" ? "Answer" : "Edit answer"}</button>}
      {q.status !== "open" && <button type="button" disabled={!!pending || !map.connected} onClick={() => update(q, "open")}>Reopen</button>}
      {q.status !== "archived" && <button type="button" disabled={!!pending || !map.connected} onClick={() => update(q, "archived")}>Archive</button>}
    </div>
  </li>);
  return <section className="saved-questions" aria-label="Saved questions">
    <button type="button" ref={opener} aria-expanded={open} onClick={() => setOpen(value => !value)}>Saved questions · {map.questions.length}</button>
    {open && <div className="saved-questions-body" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <div className="saved-questions-tools"><strong>Saved on this shared map</strong><button type="button" onClick={close}>Close</button></div>
      <p>Only questions you deliberately save here. Your answer records your words; it approves no external action.</p>
      {!map.connected && <p role="status">Disconnected. Review your saved questions; writes wait for your next click when connected.</p>}
      <form onSubmit={event => {
        event.preventDefault();
        const thought_id = link ? latestThought(map) : null;
        if (link && !thought_id) { setMessage("No placed thought in the current topic. Uncheck Link latest thought to save without a source."); return; }
        save({ id: crypto.randomUUID(), text, thought_id, answer: "", status: "open", expected_revision: 0 });
      }}>
        <label>Question<textarea ref={capture} value={text} maxLength={560} rows={2} onChange={event => setText(event.target.value)} /></label>
        <small>{Array.from(text).length}/280 characters</small>
        <label className="saved-questions-link"><input type="checkbox" checked={link} onChange={event => setLink(event.target.checked)} />Link latest thought</label>
        <button type="submit" disabled={!!pending || !map.connected}>Save question</button>
      </form>
      <p role="status" aria-live="polite">{message}</p>
      {editing && <form onSubmit={event => { event.preventDefault(); save({ id: editing.id, text: editText, thought_id: editing.thought_id, answer, status: "answered", expected_revision: editing.revision }); }}>
        <label>Edit question<textarea value={editText} rows={2} maxLength={560} onChange={event => setEditText(event.target.value)} /></label>
        <label>Your answer<textarea ref={editor} value={answer} rows={3} maxLength={4000} onChange={event => setAnswer(event.target.value)} /></label>
        <small>{Array.from(answer).length}/2,000 characters · Human-entered answer</small>
        <div className="saved-questions-tools">
          <button type="submit" disabled={!!pending || !map.connected}>Save answer</button>
          <button type="button" disabled={!!pending} onClick={() => { setEditing(null); capture.current?.focus(); }}>Cancel</button>
          <button type="button" disabled={!!pending} onClick={() => { const current = map.questions.find(q => q.id === editing.id); if (current) edit(current); }}>Review current record</button>
        </div>
      </form>}
      <div className="saved-questions-tools" aria-label="Question lists">
        <button type="button" aria-pressed={tab === "open"} onClick={() => setTab("open")}>Open</button>
        <button type="button" aria-pressed={tab === "answered"} onClick={() => setTab("answered")}>Answered</button>
      </div>
      <ul className="saved-questions-list">{rows(map.questions.filter(q => q.status === tab))}</ul>
      {!map.questions.some(q => q.status === tab) && <p>No {tab} questions yet.</p>}
      <details><summary>Archived ({map.questions.filter(q => q.status === "archived").length})</summary><ul className="saved-questions-list">{rows(map.questions.filter(q => q.status === "archived"))}</ul></details>
    </div>}
  </section>;
}
