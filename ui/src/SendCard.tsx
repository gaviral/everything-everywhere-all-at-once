// The ready-to-send message card (send-card.ts has its rules; core/src/messages.rs sends). Up under the header while
// it counts down, with Stop; Esc stops it from anywhere. Once it ends it says how, for a reading time, then goes.
import { useEffect, useMemo, useRef, useState } from "react";
import { announcement, cardWords, elapsed, lingerMs, nextTick, STATE_CLASS, stopsOnKey, type Card } from "./send-card";
import "./send-card.css";
import { Markdown } from "./md";

export function SendCard({ card, onStop, onGone }: { card: Card | null; onStop: (id: number) => void; onGone: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const element = useRef<HTMLElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setHovered(false); setFocused(false); }, [card?.id]);

  // Removing Stop can move the card away without blur/leave events. Reconcile
  // after layout and on later pointer movement, including movement outside the card.
  useEffect(() => {
    setFocused(!!element.current?.contains(document.activeElement));
    const frame = requestAnimationFrame(() => setHovered(!!element.current?.matches(":hover")));
    const moved = (event: PointerEvent) => setHovered(!!element.current?.contains(event.target as Node));
    document.addEventListener("pointermove", moved, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointermove", moved, true); };
  }, [card?.id, card?.state, card?.stopPending]);

  // The digit changes on each whole second left, not on a fixed beat, so it never shows a second it has passed.
  useEffect(() => {
    if (!card) return;
    if (card.state !== "counting") {
      if (hovered || focused) return;
      const timer = window.setTimeout(() => onGone(card.id), lingerMs(card));
      return () => window.clearTimeout(timer);
    }
    if (card.stopPending) return;
    let timer: number | undefined;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      const next = nextTick(card, at);
      if (next > 0) timer = window.setTimeout(tick, next);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [card, onGone, hovered, focused]);

  // Before the map's own Esc (it folds threads), and wherever focus is: stopping a message comes first.
  useEffect(() => {
    if (!card || card.state !== "counting") return;
    const key = (event: KeyboardEvent) => {
      if (!stopsOnKey(card, event.key, Date.now())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onStop(card.id);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [card, onStop]);

  // The bar starts where the count was when this card came (read once: the bar's own animation keeps time after), and
  // runs to its end on its own.
  const startedAt = useMemo(() => (card ? elapsed(card, Date.now()) : 0), [card?.id]);

  if (!card) return null;
  const words = cardWords(card, now);
  const counting = card.state === "counting";
  const done = startedAt;
  // Without motion, the bar steps with the digits instead (`--left`, the share of the count still to go).
  const bar = counting ? { animationDuration: `${card.total}ms`, animationDelay: `-${Math.round(done * card.total)}ms`, "--left": 1 - elapsed(card, now) } as React.CSSProperties : undefined;
  return (
    <section ref={element} className={`send-card ${STATE_CLASS[card.state]}`} aria-label={words.heading} data-guide="send-card"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
      <div className="sr-only" role="status">{announcement(card)}</div>
      <div className="send-card-head" aria-hidden="true">{words.heading}</div>
      {card.channel === "email" && <div className="send-card-subject"><strong>Subject:</strong> {card.subject}</div>}
      <p className="send-card-text"><Markdown text={card.text} /></p>
      <div className="send-card-foot">
        <span className="send-card-status" aria-hidden="true">{words.status}</span>
        {words.stop && (
          <button type="button" className="send-card-stop" onClick={() => onStop(card.id)} aria-label={`Stop: don't send to ${card.to}`}>
            Stop <kbd>esc</kbd>
          </button>
        )}
      </div>
      {counting && <div className="send-card-bar" aria-hidden="true"><span key={card.id} style={bar} /></div>}
    </section>
  );
}
