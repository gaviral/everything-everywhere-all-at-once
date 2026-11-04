import { useEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { useVocabulary } from "./connection";
import { EXAMPLES, problem, type Record, type Term } from "./rules";
import { TermEditor } from "./TermEditor";
import "./my-words.css";

export default function MyWords({ map }: BrickProps) {
  const example = location.pathname.endsWith("/bricks.html");
  return <Vocabulary key={`${map.mapIdentity}:${map.me}`} name={map.me} identity={map.connected ? map.mapIdentity ?? null : null} example={example} />;
}
function Vocabulary({ name, identity, example }: { name: string; identity: string | null; example: boolean }) {
  const [record, setRecord] = useState<Record>({ revision: 0, terms: [] });
  const [draft, setDraft] = useState<Term[]>([]);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const [conflict, setConflict] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const channel = useVocabulary(name, example ? null : identity, (next, saved) => {
    setRecord(next);
    if (saved || !dirtyRef.current) { setDraft(next.terms); setDirty(false); setConflict(false); }
    else { setConflict(true); }
  });
  const status = example ? "Example preview · saving and recognition are unavailable here." : channel.status;
  return <section className="my-words" aria-label="My words" data-guide="my-words" onKeyDown={event => event.stopPropagation()}>
    <div className="my-words-intro"><div><span className="my-words-eyebrow">Before you listen</span><h2>Give names a head start.</h2></div><span className="my-words-mark" aria-hidden="true">Aa</span></div>
    <p className="my-words-lead">The names and terms you want heard correctly.</p>
    <div className="my-words-chips" aria-label={record.terms.length ? "Saved vocabulary" : "Examples, not saved"}>
      {(record.terms.length ? record.terms : EXAMPLES).slice(0, 4).map(row => <span key={row.term}>{row.term}</span>)}
      {!record.terms.length && <small>Examples · not saved</small>}
      {record.terms.length > 4 && <small>+{record.terms.length - 4} more</small>}
    </div>
    <button className="my-words-primary" type="button" onClick={() => setOpen(true)}>Prepare next session <span aria-hidden="true">↗</span></button>
    {dirty && <span className="my-words-note">Unsaved draft</span>}
    {open && <WordDialog close={() => setOpen(false)}>
      <span className="my-words-eyebrow">Your vocabulary · {name}</span><h2>Make room for your words.</h2>
      <p className="my-words-lead">Saved on this map for you. Applies to new listening sessions while My words is enabled in one of your windows.</p>
      <p className="my-words-note">Recognition hints can help; spelling is not guaranteed. Existing transcripts stay as they are. This editor never starts the microphone.</p>
      <TermEditor key={record.revision} terms={draft} busy={channel.pending} change={next => { setDraft(next); setDirty(true); setError(""); }} />
      {conflict && <div className="my-words-error" role="alert">The saved list was reloaded. Your draft is retained; review the saved list before replacing it.
        <button type="button" onClick={() => { setDraft(record.terms); setDirty(false); setConflict(false); }}>Use saved list</button>
        <button type="button" onClick={() => setConflict(false)}>Keep my draft instead</button>
      </div>}
      {error && <p role="alert" className="my-words-error">{error}</p>}
      <p className="my-words-status" role="status">{status}</p>
      <div className="my-words-footer"><button className="my-words-primary" type="button" disabled={example || !channel.ready || channel.pending || !dirty || conflict} onClick={() => {
        const issue = problem(draft); setError(issue); if (!issue) channel.save(record.revision, draft);
      }}>Save for next session</button>
        {!example && <button type="button" disabled={channel.pending} onClick={channel.reconnect}>Reconnect / review saved</button>}
        <button type="button" disabled={!dirty || channel.pending} onClick={() => { setDraft(record.terms); setDirty(false); setConflict(false); setError(""); }}>Discard draft</button>
      </div>
    </WordDialog>}
  </section>;
}
function WordDialog({ close, children }: { close: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="my-words-dialog" aria-label="Prepare your vocabulary" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="my-words-sheet"><button type="button" className="my-words-close" onClick={close}>Close</button>{children}</div>
  </dialog>;
}
