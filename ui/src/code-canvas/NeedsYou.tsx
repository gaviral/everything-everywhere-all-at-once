import { useEffect, useRef, useState } from 'react';
import type { Need } from './types';
function AnswerCard({ need, answered }: { need: Need; answered: (id: string) => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setStatus('Saving answer…');
    try {
      const response = await fetch('/code-canvas/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: need.id, answer: text }) });
      if (!response.ok) throw new Error('Answer was not saved. Your card and draft are still here. Try again.');
      answered(need.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Answer was not saved. Try again.'); }
    finally { setBusy(false); }
  }
  return <article className="cc-need"><h3>{need.title}</h3>{need.lane && <small>{need.lane}</small>}<p>{need.detail}</p>
    <form onSubmit={save}><label>Your answer<textarea aria-label={`Answer: ${need.title}`} required maxLength={4000} value={text} onChange={e => setText(e.target.value)} /></label><button disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save answer'}</button><p role="status">{status}</p></form>
  </article>;
}
export function NeedsYou({ needs, refresh, confirmed, loading }: { needs: Need[]; refresh: () => void; confirmed: boolean; loading: boolean }) {
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width:1100px)').matches);
  const [open, setOpen] = useState(() => !matchMedia('(max-width:1100px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width:1100px)');
    const changed = () => { setNarrow(media.matches); setOpen(false); };
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const sheet = dialog.current;
    if (!sheet) return;
    if (narrow && open && !sheet.open) sheet.showModal();
    else if (sheet.open) sheet.close();
  }, [narrow, open]);
  const pending = needs.filter(n => !answered.has(n.id));
  function complete(id: string) { setAnswered(old => new Set([...old, id])); refresh(); if (narrow) dialog.current?.querySelector('button')?.focus(); else toggle.current?.focus(); }
  function close() { setOpen(false); toggle.current?.focus(); }
  const empty = confirmed ? (answered.size ? 'Answer saved. Nothing else needs you.' : 'Nothing waiting on you.') : loading ? 'Reading requests…' : 'Requests unavailable. There may be work waiting on you.';
  const body = <div className="cc-needs-body">{!!pending.length && <p className="cc-note">Cards stay until you answer. Answers are saved locally for the agent to read.</p>}{pending.map(need => <AnswerCard key={need.id} need={need} answered={complete} />)}{!pending.length && <p role="status">{empty}</p>}</div>;
  return <aside className={`cc-needs ${open ? 'is-open' : ''}`} aria-label="Needs you">
    <button ref={toggle} className="cc-needs-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><span>Needs you <strong>{pending.length || (confirmed ? '0' : '?')}</strong></span><span>{open ? 'Minimize' : 'Open'}</span></button>
    {narrow ? <dialog ref={dialog} className="cc-needs-sheet" onCancel={close} onClose={() => { setOpen(false); toggle.current?.focus(); }} aria-label="Needs you"><div className="cc-sheet-heading"><strong>Needs you · {pending.length || (confirmed ? '0' : '?')}</strong><button onClick={close}>Close</button></div>{body}</dialog> : open && body}
  </aside>;
}
