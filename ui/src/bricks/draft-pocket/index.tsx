import { useEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { keep, keepInput, MAX_CHARACTERS, pocketFor, takeInput, textError, warning, type Draft } from "./rules";
import "./draft-pocket.css";

export default function DraftPocket({ map, actions }: BrickProps) {
  // A changed identity gets its own editor as well as its own entries.
  return <Pocket key={map.me} person={map.me} actions={actions} />;
}

function Pocket({ person, actions }: { person: string; actions: BrickProps["actions"] }) {
  const pocket = pocketFor(person);
  const [, redraw] = useState(0);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [deleted, setDeleted] = useState<{ draft: Draft; at: number }[]>([]);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const editReturn = useRef<HTMLButtonElement | null>(null);
  const sending = useRef(new Set<string>());
  useEffect(() => {
    // The host has no input-state action. Use its labeled native field, without accessing React internals
    // or changing submission: the input's normal onChange receives the restored value.
    let input: HTMLTextAreaElement | null = null;
    const checkpoint = () => {
      if (!input) return;
      const before = warning();
      keepInput(person, input.value);
      if (before !== warning()) redraw(n => n + 1);
    };
    const observer = new MutationObserver(() => attach());
    function attach() {
      input = document.querySelector<HTMLTextAreaElement>('[data-guide="composer"] textarea');
      if (!input) return false;
      observer.disconnect();
      const saved = takeInput(person);
      if (saved !== undefined && !input.value) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, saved);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      checkpoint();
      input.addEventListener("input", checkpoint);
      window.addEventListener("pagehide", checkpoint);
      return true;
    }
    // The map's editor can arrive after this feature. Its mounted field is the readiness signal.
    if (!attach()) observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (!input) return;
      input.removeEventListener("input", checkpoint);
      window.removeEventListener("pagehide", checkpoint);
      keepInput(person, ""); // Off restores baseline behavior; the pocket's entries remain.
    };
  }, [person]);
  const refresh = () => redraw(n => n + 1);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const cancelEdit = () => {
    pocket.editing = null;
    pocket.input = "";
    setMessage("");
    refresh();
    editReturn.current?.focus();
  };
  const save = () => {
    const error = textError(pocket.input);
    if (error) { setMessage(error); return; }
    const editing = pocket.editing;
    const draft: Draft = { id: editing ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-"), text: pocket.input, saved: Date.now(),
      submitted: pocket.entries.find(d => d.id === editing)?.submitted ?? false };
    const next = editing ? pocket.entries.map(d => d.id === editing ? draft : d) : [...pocket.entries, draft];
    const refused = keep(person, next);
    if (refused) { setMessage(refused); return; }
    pocket.input = "";
    pocket.editing = null;
    setMessage(editing ? "Draft updated here." : "Draft kept here. Nothing submitted.");
    refresh();
    field.current?.focus();
  };
  const send = (draft: Draft, button: HTMLButtonElement) => {
    if (draft.submitted || sending.current.has(draft.id)) return;
    // Both the DOM and the guard change before invoking the synchronous action: a double-click cannot submit twice.
    button.disabled = true;
    sending.current.add(draft.id);
    let accepted = false;
    try { accepted = actions.addThought(draft.text); } catch { /* preserve the words and offer an explicit retry */ }
    if (accepted) {
      keep(person, pocket.entries.map(d => d.id === draft.id ? { ...d, submitted: true } : d), true);
      setMessage("Submitted to E2A2O. The draft stays here until you delete it.");
    } else {
      sending.current.delete(draft.id);
      button.disabled = false;
      setFailed(previous => new Set(previous).add(draft.id));
      setMessage("Not submitted. Your words are still here; Retry when ready.");
    }
    refresh();
  };

  return <section className="draft-pocket" aria-label="Draft pocket" data-guide="draft-pocket" onKeyDown={event => {
      if (event.key !== "Escape" || !open) return;
      event.stopPropagation();
      event.preventDefault();
      if (pocket.editing) cancelEdit(); else close();
    }}>
    <button type="button" className="draft-pocket-trigger" ref={trigger} aria-expanded={open} aria-controls="draft-pocket-body"
      onClick={() => setOpen(value => !value)}>Draft pocket · {pocket.entries.length}/8</button>
    {!open && warning() && <p className="draft-pocket-warning" role="alert">{warning()}</p>}
    {open && <div className="draft-pocket-body" id="draft-pocket-body">
      <div className="draft-pocket-heading"><strong>Unsent · this tab</strong><button type="button" onClick={close}>Close</button></div>
      <p className="draft-pocket-help">Kept for this person in this tab. Only Send as thought submits words to E2A2O.</p>
      <label className="draft-pocket-label" htmlFor="draft-pocket-input">{pocket.editing ? "Edit pocket draft" : "New pocket draft"}</label>
      <textarea className="draft-pocket-input" id="draft-pocket-input" ref={field} rows={3} value={pocket.input}
        onFocus={event => event.currentTarget.scrollIntoView({ block: "nearest" })}
        aria-describedby="draft-pocket-count" onChange={event => { pocket.input = event.target.value; refresh(); }} />
      <p className="draft-pocket-help" id="draft-pocket-count">{pocket.input.length}/{MAX_CHARACTERS} characters · Enter adds a line</p>
      <div className="draft-pocket-controls">
        <button type="button" onClick={save}>{pocket.editing ? "Save changes" : "Save draft"}</button>
        {pocket.editing && <button type="button" onClick={cancelEdit}>Cancel edit</button>}
      </div>
      <p className="draft-pocket-status" role="status">{message}</p>
      {warning() && <p className="draft-pocket-warning" role="alert">{warning()}</p>}
      {!pocket.entries.length && <p className="draft-pocket-help">No drafts here yet. Park a few words above.</p>}
      <ul className="draft-pocket-list">
        {pocket.entries.map(draft => <li className="draft-pocket-entry" key={draft.id}>
          <p className="draft-pocket-title">{draft.text.split(/\r?\n/)[0] || "(Blank first line)"}</p>
          <time className="draft-pocket-time" dateTime={new Date(draft.saved).toISOString()}>Saved {new Date(draft.saved).toLocaleString()}</time>
          {draft.submitted && <p className="draft-pocket-help">Submitted to E2A2O · later edits stay here</p>}
          <div className="draft-pocket-controls">
            <button type="button" onClick={event => {
              pocket.editing = draft.id; pocket.input = draft.text; editReturn.current = event.currentTarget;
              setMessage(""); refresh(); field.current?.focus();
            }}>Edit</button>
            <button type="button" disabled={draft.submitted || pocket.editing === draft.id} onClick={event => send(draft, event.currentTarget)}>
              {draft.submitted ? "Submitted" : failed.has(draft.id) ? "Retry" : "Send as thought"}
            </button>
            <button type="button" onClick={() => {
              const at = pocket.entries.findIndex(d => d.id === draft.id);
              keep(person, pocket.entries.filter(d => d.id !== draft.id));
              setDeleted(previous => [...previous, { draft, at }]);
              if (pocket.editing === draft.id) { pocket.editing = null; pocket.input = ""; }
              setMessage("Draft deleted here. Undo is available while this feature stays on.");
              refresh(); field.current?.focus();
            }}>Delete</button>
          </div>
        </li>)}
      </ul>
      {deleted.map(({ draft, at }) => <div className="draft-pocket-controls" key={draft.id}>
        <span>Draft deleted</span><button type="button" onClick={() => {
          const next = [...pocket.entries]; next.splice(at, 0, draft);
          const refused = keep(person, next);
          setMessage(refused || "Draft restored here.");
          if (!refused) setDeleted(previous => previous.filter(item => item.draft.id !== draft.id));
          refresh(); field.current?.focus();
        }}>Undo</button>
      </div>)}
    </div>}
  </section>;
}
