// The note card (note-card.ts has its rules; core/src/notes.rs writes). Up under the header with the note it makes:
// its title, its points with decisions and unfinished ones marked, and what happened. Once Notes has it, Open in
// Notes shows it there. The app never deletes a note: the card only ever opens one.
import { useEffect, useState } from "react";
import { announcement, cardWords, lingerMs, pointWords, STATE_CLASS, type NoteCard as Card } from "./note-card";
import "./note-card.css";

export function NoteCard({ card, onOpen, onGone }: { card: Card | null; onOpen: (id: number) => void; onGone: (id: number) => void }) {
  // The pointer on it or focus in it holds it up: someone reading the points or reaching for Open isn't done.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!card || held) return;
    const linger = lingerMs(card);
    if (linger <= 0) return;
    const timer = window.setTimeout(() => onGone(card.id), linger);
    return () => window.clearTimeout(timer);
  }, [card, held, onGone]);

  if (!card) return null;
  const words = cardWords(card);
  return (
    <section
      className={`note-card ${STATE_CLASS[card.state]}`}
      aria-label={`${words.heading}: ${card.title}`}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="sr-only" role="status">{announcement(card)}</div>
      <div className="note-card-head">
        <span aria-hidden="true">{words.heading}</span>
        <button type="button" className="note-card-close" onClick={() => onGone(card.id)} aria-label="Close the note card">×</button>
      </div>
      <h2 className="note-card-title">{card.title}</h2>
      <div className="note-card-body">
        {card.sections.map((section, i) => (
          <div key={i}>
            {section.title && <h3 className="note-card-branch">{section.title}</h3>}
            <ul className="note-card-points">
              {section.points.map((point, j) => (
                <li key={j} className={point.unfinished ? "is-unfinished" : undefined}>
                  {point.decided && <span className="decided"><span aria-hidden="true">✓ </span>Decided</span>}
                  <span>{pointWords(point)}</span>
                  {point.unfinished && <span className="note-card-mark">unfinished</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="note-card-foot">
        <span className="note-card-status">{words.status}</span>
        {words.open && (
          <button type="button" className="note-card-open" onClick={() => onOpen(card.id)}>
            Open in Notes
          </button>
        )}
      </div>
    </section>
  );
}
