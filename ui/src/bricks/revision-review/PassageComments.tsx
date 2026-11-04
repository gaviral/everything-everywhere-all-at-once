import { useRef, useState } from 'react';
import type { Annotation, Command, Passage, Revision } from './model';
import { PassagePicker } from './PassagePicker';

function selectedPassage(root: HTMLElement): Passage | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const quote = range.toString();
  return quote.trim() ? { start, end: start + quote.length, quote } : null;
}

export function PassageComments({ revision, comments, actor, send }: { revision: Revision; comments: Annotation[]; actor: string; send: (command: Command) => void }) {
  const passageRoot = useRef<HTMLParagraphElement>(null);
  const [passage, choose] = useState<Passage | null>(null);
  const [text, write] = useState('');
  const [message, inform] = useState('');
  return <section className="revision-review-passage" aria-label="Artifact and passage comments">
    <p className="revision-review-eyebrow">The artifact · revision {revision.number}</p>
    <h2>{revision.title}</h2>
    <p className="revision-review-words" ref={passageRoot} aria-label="Artifact words">{revision.body}</p>
    <button type="button" onClick={() => {
      const picked = passageRoot.current && selectedPassage(passageRoot.current);
      choose(picked); inform(picked ? '' : 'Select words in this artifact first, or open the keyboard selector below.');
    }}>Comment on selected words</button>
    <p className="revision-review-hint">Select an exact passage above. A comment never approves the work.</p>
    <PassagePicker body={revision.body} choose={picked => { choose(picked); inform(''); }} />
    {passage && <form className="revision-review-comment-form" onSubmit={event => {
      event.preventDefault(); send({ kind: 'comment', passage, text, actor }); write(''); choose(null); inform('Comment attached to this revision.');
    }}>
      <blockquote>{passage.quote}</blockquote>
      <label>Your comment<textarea value={text} onChange={event => write(event.target.value)} maxLength={4000} required /></label>
      <button type="submit" disabled={!text.trim()}>Attach comment</button>
      <button type="button" onClick={() => choose(null)}>Cancel comment</button>
    </form>}
    <p role="status">{message}</p>
    <div className="revision-review-comments" aria-label="Comments on this revision">
      <h3>Passage comments <span>{comments.length}</span></h3>
      {comments.length === 0 && <p>No comments on this revision.</p>}
      {comments.map(comment => <article key={comment.id}>
        <blockquote>{comment.quote}</blockquote><p>{comment.text}</p><small>{comment.actor} · r{comment.revision} · characters {comment.start + 1}–{comment.end}</small>
      </article>)}
    </div>
  </section>;
}
