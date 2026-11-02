// Tiny transcript (docs/bricks.md, a panel): your words as you say them, very small, just above the dock, so you stay
// in the thought rather than the typing. They're `map.partial`, and brick.json's `showsLiveWords` takes them from the
// dock's big live line, so they never show twice. The first time, a hint says it's small on purpose, with a size slider.
import { useEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import "./tiny-transcript.css";

const HINTED = "e2a2o.brick.tiny-transcript.hinted";
const SIZE = "e2a2o.brick.tiny-transcript.size";

function readSetting(key: string) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function saveSetting(key: string, value: string) {
  // The transcript and its controls still work when browser storage is unavailable.
  try { localStorage.setItem(key, value); }
  catch { /* Keep the setting for this mount through React state. */ }
}

export default function TinyTranscript({ map }: BrickProps) {
  const [size, setSize] = useState(() => {
    const saved = Number(readSetting(SIZE));
    return Number.isInteger(saved) && saved >= 9 && saved <= 16 ? saved : 11;
  });
  const [hinted, setHinted] = useState(() => readSetting(HINTED) !== null);
  // The words the hint first showed with: they stay up with it once the turn ends and its words go, so there's time
  // to try the slider; the hint goes only when dismissed.
  const [held, setHeld] = useState("");
  const hint = useRef<HTMLDivElement>(null);

  // Only ever yours: the core sends a speaker's live words to that speaker's windows alone.
  const text = map.partial.trim();
  useEffect(() => { if (text && !hinted) setHeld(text); }, [text, hinted]);
  const showHint = !hinted && !!(text || held);
  const shown = text || (showHint ? held : "");

  useEffect(() => {
    if (!showHint) return;
    const dismiss = () => { setHinted(true); saveSetting(HINTED, "true"); };
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || hint.current?.contains(event.target)) return;
      dismiss();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("click", outside, true); document.removeEventListener("keydown", key, true); };
  }, [showHint]);

  if (!shown) return null;

  return <div className="tiny-transcript">
    {showHint && <div className="tiny-transcript-hint" ref={hint}>
      <p className="tiny-transcript-help">Intentionally small. You can make it bigger here.</p>
      <input className="tiny-transcript-size" type="range" min="9" max="16" step="1" value={size}
        aria-label="Transcript font size" aria-valuetext={`${size} pixels`}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setSize(next);
          saveSetting(SIZE, String(next));
        }} />
    </div>}
    {/* The words in an isolate of their own: the line runs from its end (the CSS), and they keep their own order. */}
    <div className="tiny-transcript-text" style={{ fontSize: size }}><bdi>{shown}</bdi></div>
  </div>;
}
