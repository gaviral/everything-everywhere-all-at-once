import type { Material, Notebook, Reference } from './model';

export function NotesView({ notebook, material, title, change, read }: {
  notebook: Notebook; material: Material; title: string; change(next: Notebook): void; read(reference: Reference): void;
}) {
  return <section className="topic-views-notes" aria-label="Independent notes">
    <p className="topic-views-eyebrow">Your thinking, in your words</p>
    <label htmlFor="topic-views-note">Notes on {title}</label>
    <textarea id="topic-views-note" value={notebook.text} maxLength={6000} placeholder="What matters here? Write your own take…"
      onChange={event => change({ ...notebook, text: event.target.value })} />
    <p>Local to this tab’s visit · kept when you leave this view · clears on reload.</p>
    <h3>Linked sources <span>{notebook.references.length}</span></h3>
    {!notebook.references.length && <p>Use “Keep reference in Notes” on a topic point or conversation thought to link its original words.</p>}
    {notebook.references.map(reference => {
      const source = material.thoughts.find(thought => thought.id === reference.id);
      return <article className="topic-views-reference" key={reference.id}>
        <p className="topic-views-eyebrow">{reference.speaker} · Source {reference.id}</p>
        <blockquote>{reference.words}</blockquote>
        {!source ? <p>Source no longer on map · captured words retained.</p> : source.text !== reference.words && <p>Source changed · captured words retained.</p>}
        <button type="button" disabled={!source} onClick={() => read(reference)}>Read source in conversation ↗</button>
      </article>;
    })}
  </section>;
}
