// The GitHub card (pulls-card.ts has its rules; core/src/github.rs reads gh). Up under the header: the pull requests,
// each a link that opens it on GitHub. It stays while the pointer or focus is on it; × or Esc (from inside) closes it.
import { useEffect, useMemo, useState } from "react";
import { allUrl, announcement, CARD_CLASS, CHECKS_CLASS, PULL_CLASS, lingerMs, rowWords, safeUrl, statusLine, type Card } from "./pulls-card";
import "./pulls-card.css";

const CHECK_MARK: Record<string, string> = { passing: "✓", failing: "✕", running: "●", none: "" };

export function PullsCard({ card, onGone }: { card: Card | null; onGone: (id: number) => void }) {
  // Held while the pointer or focus is on it, each kept apart: moving the pointer off leaves a focused row up.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  // "Updated 3 h ago" is read against when the answer came; the card is up a minute or two, so it stays true enough.
  const now = useMemo(() => Date.now(), [card]);

  useEffect(() => {
    if (!card || held) return;
    const ms = lingerMs(card, now);
    if (ms <= 0) return;
    const timer = window.setTimeout(() => onGone(card.id), ms);
    return () => window.clearTimeout(timer);
  }, [card, held, now, onGone]);

  if (!card) return null;
  const status = statusLine(card);
  const all = card.more ? allUrl(card) : null;
  return (
    <section
      className={`pulls-card ${CARD_CLASS[card.state]}`}
      aria-label={card.repo ? `${card.title} in ${card.repo}` : card.title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onGone(card.id); } }}
    >
      <div className="sr-only" role="status">{announcement(card)}</div>
      <div className="pulls-card-head">
        <span className="pulls-card-title">{card.title}</span>
        {card.repo && <span className="pulls-card-repo">{card.repo}</span>}
        <button type="button" className="pulls-card-close" onClick={() => onGone(card.id)} aria-label="Close the GitHub card">×</button>
      </div>
      {status && <p className="pulls-card-status" aria-hidden="true">{status}</p>}
      {card.pulls.length > 0 && (
        <ul className="pulls-card-list">
          {card.pulls.map((pull) => {
            const url = safeUrl(pull.url);
            const words = rowWords(pull, now);
            const body = (
              <>
                <span className="pulls-card-number">#{pull.number}</span>
                <span className="pulls-card-main">
                  <span className="pulls-card-name">{pull.title}</span>
                  <span className="pulls-card-meta">
                    <span className={`pulls-card-state ${PULL_CLASS[pull.state]}`}>{words.state}</span>
                    {words.checks && <span className={`pulls-card-checks ${CHECKS_CLASS[pull.checks]}`}><span aria-hidden="true">{CHECK_MARK[pull.checks]}</span> {words.checks}</span>}
                    {words.when && <span className="pulls-card-when">{words.when}</span>}
                  </span>
                </span>
              </>
            );
            return (
              <li key={pull.number}>
                {url ? <a className="pulls-card-row" href={url} target="_blank" rel="noopener noreferrer" aria-label={words.label}>{body}</a> : <div className="pulls-card-row">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {all && <a className="pulls-card-all" href={all} target="_blank" rel="noopener noreferrer">See all on GitHub</a>}
    </section>
  );
}
