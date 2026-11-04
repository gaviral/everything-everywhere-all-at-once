import { useLayoutEffect, useRef } from 'react';
import type { Thought } from '../contract';
import { originalWords } from './model';

export function SourceCard({ thought, topic, original, selected, kept, read, pin, open }: {
  thought: Thought; topic: string; original: boolean; selected: boolean; kept: boolean;
  read(): void; pin(): void; open?: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (original && selected) { card.current?.focus({ preventScroll: true }); card.current?.scrollIntoView({ block: 'nearest' }); }
  }, [original, selected]);
  return <article ref={card} tabIndex={-1} className="topic-views-source" data-source={thought.id} data-selected={selected}>
    <p className="topic-views-eyebrow">{original ? thought.speaker : 'Topic point'} <span>· {topic}</span></p>
    <blockquote>{original ? originalWords(thought) : thought.point || originalWords(thought)}</blockquote>
    <div className="topic-views-source-tools">
      {!original && <button type="button" onClick={read}>Read original words ↗</button>}
      <button type="button" disabled={kept} onClick={pin}>{kept ? 'Reference kept in Notes' : 'Keep reference in Notes'}</button>
      {original && open && <button type="button" onClick={open}>Open on map ↗</button>}
    </div>
    <small className="topic-views-identity">Source {thought.id}</small>
  </article>;
}
