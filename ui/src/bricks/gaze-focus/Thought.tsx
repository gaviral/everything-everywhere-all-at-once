import { useState } from "react";
import type { BrickActions } from "../contract";
import type { Focus } from "./use-tracking";

export function focusContext(focus: Focus): string {
  const source = focus.mode === "demo" ? "simulated demo, not measured gaze" : `${focus.method}; approximate, not exact eye tracking`;
  return `What I was looking at (${source}): ${focus.target.example ? "example topic " : "topic "}“${focus.target.title}”.`;
}

export function Thought({ focus, actions, connected }: { focus: Focus | null; actions: BrickActions; connected: boolean }) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<Focus | null>(null);
  const [notice, setNotice] = useState("");
  const chosen = text ? attached : focus;
  return <form className="gaze-focus-thought" onSubmit={event => {
    event.preventDefault();
    if (!text.trim() || !chosen || !connected) return;
    if (actions.addThought(`${text.trim()}\n\n${focusContext(chosen)}`)) {
      setText(""); setAttached(null); setNotice("Submitted with focus context.");
    } else setNotice("Not sent. Your thought is still here.");
  }}>
    <label htmlFor="gaze-focus-thought">Next thought</label>
    <textarea id="gaze-focus-thought" rows={2} maxLength={1800} placeholder="What about this idea…" value={text}
      onChange={event => { if (!text) setAttached(focus); setText(event.target.value); setNotice(""); }} />
    <p className="gaze-focus-attached">{chosen ? `With ${chosen.target.example ? "example: " : ""}${chosen.target.title} · ${chosen.mode === "demo" ? "simulated" : "estimated"}` : "Waiting for a focus estimate…"}</p>
    <button type="submit" disabled={!text.trim() || !chosen || !connected}>Send with focus ↗</button>
    <p className="gaze-focus-note">Send here to include the context shown above. Your usual input stays separate.</p>
    {notice && <p className="gaze-focus-note" role="status">{notice}</p>}
  </form>;
}
