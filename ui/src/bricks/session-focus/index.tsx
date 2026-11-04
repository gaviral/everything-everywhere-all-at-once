import { useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { clean, keep, problem, visit, type Focus } from "./rules";
import "./session-focus.css";

export default function SessionFocus(props: BrickProps) {
  return <FocusCard key={props.map.me} {...props} />;
}

function FocusCard({ map, actions }: BrickProps) {
  const state = visit(map.me);
  const [, redraw] = useState(0);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const edit = useRef<HTMLButtonElement>(null);
  const goal = useRef<HTMLInputElement>(null);
  const active = map.threads.find(t => t.id === map.active);
  const attached = map.threads.find(t => t.id === state.saved?.topicId);
  const update = (field: keyof Focus, value: string) => {
    state.draft = { ...state.draft, [field]: value };
    setError(""); redraw(n => n + 1);
  };
  const close = () => { setEditing(false); setError(""); edit.current?.focus(); };
  const save = () => {
    const value = clean(state.draft);
    const issue = problem(value) || keep(map.me, value);
    setError(issue);
    if (!issue) { state.undo = null; close(); }
  };
  return <section className="session-focus" aria-label="This tab’s focus" data-guide="session-focus-card" onKeyDown={e => e.stopPropagation()}>
    <div className="session-focus-heading">
      <strong>This tab’s focus</strong>
      <button ref={edit} type="button" aria-expanded={editing} onClick={() => setEditing(true)}>Edit focus</button>
    </div>
    <p className="session-focus-scope">Only for you in this tab · may end when the tab closes.</p>
    {!state.kept && <p className="session-focus-status" role="status">Not kept after reload</p>}
    {editing ? <form className="session-focus-form" aria-label="Edit focus" onSubmit={e => { e.preventDefault(); save(); }}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } }}>
      <label>Goal (required, 160 characters max)
        <input ref={goal} autoFocus required maxLength={160} value={state.draft.goal} onChange={e => update("goal", e.target.value)} />
      </label>
      <label>Why (optional, 280 characters max)
        <textarea rows={3} maxLength={280} value={state.draft.why} onChange={e => update("why", e.target.value)} />
      </label>
      <label>Next step (optional, 160 characters max)
        <input maxLength={160} value={state.draft.next} onChange={e => update("next", e.target.value)} />
      </label>
      <p className="session-focus-scope">{state.draft.topicId ? `Attached topic: ${map.threads.find(t => t.id === state.draft.topicId)?.title ?? "Unavailable"}` : "No topic attached."}</p>
      <div className="session-focus-controls">
        <button type="button" disabled={!active} onClick={() => { if (active) update("topicId", active.id); }}>Use this topic</button>
        {state.draft.topicId && <button type="button" onClick={() => update("topicId", "")}>Detach topic</button>}
      </div>
      {!active && <p className="session-focus-scope">Open a topic to attach it.</p>}
      {error && <p className="session-focus-status" role="alert">{error}</p>}
      <div className="session-focus-controls">
        <button type="submit">Save focus</button>
        <button type="button" onClick={close}>Close</button>
      </div>
    </form> : <>
      {state.saved ? <>
        <p className="session-focus-goal">{state.saved.goal}</p>
        <details className="session-focus-more">
          <summary>More</summary>
          <p><strong>Why</strong><span>{state.saved.why || "No reason added."}</span></p>
          <p><strong>Next step</strong><span>{state.saved.next || "No next step added."}</span></p>
        </details>
        {state.saved.topicId && (attached
          ? <button type="button" onClick={() => actions.openThread(attached.id)}>Open topic: {attached.title}</button>
          : <p className="session-focus-scope">Attached topic unavailable</p>)}
        <div className="session-focus-controls"><button type="button" onClick={() => {
          const previous = state.saved;
          const issue = keep(map.me, null); setError(issue);
          if (!issue) state.undo = previous;
          redraw(n => n + 1);
        }}>Clear</button></div>
      </> : <p className="session-focus-goal">No focus yet. Choose one thing to work toward.</p>}
      {state.undo && <div className="session-focus-controls"><span>Focus cleared.</span><button type="button" onClick={() => {
        const issue = keep(map.me, state.undo); setError(issue);
        if (!issue) state.undo = null;
        redraw(n => n + 1);
      }}>Undo</button></div>}
      {error && <p className="session-focus-status" role="alert">{error}</p>}
    </>}
  </section>;
}
