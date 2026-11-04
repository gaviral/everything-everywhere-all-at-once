// Ask about words: a thin hand-drawn arrow from a word Spark can't place to its question, at your pause.
// It never interrupts: a question waits while you talk, and leaves when you answer or wave it off.
import { useEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import { askAbout, type Ask } from "./asking";
import { rangeOf, underline } from "./marking";
import "./clarify.css";

/** A person has paused after this long without new words. */
const PAUSE_MS = 1300;
const FOLLOW_MS = 150;
type Place = { x: number; y: number; width: number; height: number };

function arrowPath(from: Place, to: Place) {
  const startX = to.x, startY = to.y + to.height / 2;
  const endX = from.x + from.width / 2, endY = from.y + from.height + 4;
  const bendX = (startX + endX) / 2, bendY = Math.max(startY, endY) + 26;
  const angle = Math.atan2(endY - bendY, endX - bendX);
  const tip = (turn: number) => `${endX - Math.cos(angle + turn) * 13} ${endY - Math.sin(angle + turn) * 13}`;
  return `M${startX} ${startY}Q${bendX} ${bendY} ${endX} ${endY}M${tip(0.5)}L${endX} ${endY}L${tip(-0.5)}`;
}

export default function Clarify({ on, map, actions }: BrickProps) {
  const [waiting, setWaiting] = useState<Ask[]>([]);
  const [shown, setShown] = useState<Ask | null>(null);
  const [word, setWord] = useState<Place | null>(null);
  const [talking, setTalking] = useState(false);
  const paused = useRef(0);
  const asked = useRef(new Set<string>());
  const note = useRef<HTMLDivElement>(null);

  useBrickEvent(on, "words", words => {
    clearTimeout(paused.current);
    if (words) setTalking(true);
    paused.current = window.setTimeout(() => setTalking(false), PAUSE_MS);
  });
  useEffect(() => () => clearTimeout(paused.current), []);

  useBrickEvent(on, "landed", event => {
    if (!event.mine || asked.current.has(event.thoughtId)) return;
    asked.current.add(event.thoughtId);
    const text = map.thoughts.find(thought => thought.id === event.thoughtId)?.text;
    if (!text) return;
    if (shown && shown.thoughtId !== event.thoughtId) {  // What's said next, while a question is up, answers it.
      actions.annotate(shown.thoughtId, shown.term, text);
      setShown(null);
      return;
    }
    const context = map.thoughts.filter(thought => thought.id !== event.thoughtId).slice(-6).map(thought => thought.text);
    void askAbout(text, context).then(found => {
      if (found) setWaiting(queue => [...queue, { thoughtId: event.thoughtId, ...found }]);
    }).catch(() => {});
  });

  // One question at a time, only when the person has stopped.
  useEffect(() => {
    if (shown || talking || !waiting.length) return;
    setShown(waiting[0]);
    setWaiting(queue => queue.slice(1));
  }, [shown, talking, waiting]);

  // The Canvas moves under the question; the underline and arrow follow the word.
  useEffect(() => {
    if (!shown) { underline(null); setWord(null); return; }
    const follow = () => {
      const range = rangeOf(shown.thoughtId, shown.term);
      underline(range);
      const box = range?.getBoundingClientRect();
      setWord(box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null);
    };
    follow();
    const timer = setInterval(follow, FOLLOW_MS);
    return () => { clearInterval(timer); underline(null); };
  }, [shown]);

  if (!shown || !word) return null;
  const box = note.current?.getBoundingClientRect();
  const left = Math.min(word.x + word.width + 60, innerWidth - 460), top = Math.max(80, word.y + word.height + 54);
  const noteAt: Place = box ? { x: box.x, y: box.y, width: box.width, height: box.height } : { x: left, y: top, width: 0, height: 44 };
  return <div className="clarify">
    <svg className="clarify-arrow" aria-hidden="true"><path d={arrowPath(word, noteAt)} /></svg>
    <div className="clarify-note" ref={note} style={{ left, top }} role="status">
      <p>{shown.question}</p>
      <button onClick={() => setShown(null)}>Got it</button>
    </div>
  </div>;
}
