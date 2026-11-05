import { useState, type FormEvent } from "react";

export function Reply({ answers, onReply, disabled = false }: {
  answers: string[]; onReply: (text: string) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function send(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() && !disabled) onReply(draft.trim());
  }
  return <div className="canvas-buddy-replies">
    <div className="canvas-buddy-choices">{answers.map(answer => <button key={answer} type="button"
      disabled={disabled} onClick={() => onReply(answer)}>{answer}</button>)}</div>
    <form className="canvas-buddy-form" onSubmit={send}>
      <input aria-label="Reply to canvas buddy" placeholder="Or, in your words…" value={draft} maxLength={500}
        disabled={disabled} onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={disabled || !draft.trim()} aria-label="Send reply">↗</button>
    </form>
  </div>;
}
