import { useState } from 'react';
import { usePluginState } from '../contract';
import type { Command, Revision } from './model';

export function RevisionEditor({ revision, scope, send }: { revision: Revision; scope: string; send: (command: Command) => void }) {
  const [draft, change] = usePluginState(`${scope}:draft:${revision.number}`, { title: revision.title, body: revision.body });
  const [open, setOpen] = useState(false);
  return <section className="revision-review-editor" aria-label="New revision">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close editor' : 'Edit as new revision'}</button>
    {open && <form onSubmit={event => { event.preventDefault(); send({ kind: 'revise', ...draft }); }}>
      <p>Saving creates revision {revision.number + 1}. Comments, decisions and evidence stay on their original revision.</p>
      <label>Revision title<input value={draft.title} maxLength={120} required onChange={event => change({ ...draft, title: event.target.value })} /></label>
      <label>Revision words<textarea value={draft.body} maxLength={20000} required onChange={event => change({ ...draft, body: event.target.value })} /></label>
      <button type="submit" disabled={!draft.title.trim() || !draft.body.trim() || (draft.title.trim() === revision.title && draft.body === revision.body)}>Save new revision</button>
    </form>}
  </section>;
}
