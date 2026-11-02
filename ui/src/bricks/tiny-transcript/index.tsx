// Tiny transcript (docs/bricks.md, a panel): your words on their way, very small, just above the dock, so you stay in
// the thought rather than the typing. The contract has no live words (the dock's line while you talk), so it shows
// the newest of your thoughts not yet placed; the first time, a hint says it's small on purpose, with a size slider.
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
  // The words the hint first showed with: they stay up with it after their thought is placed (≈ 3 s), so there's
  // time to try the slider; the hint goes only when dismissed.
  const [held, setHeld] = useState("");
  const hint = useRef<HTMLDivElement>(null);

  // The contract orders thoughts by arrival; placed thoughts and other speakers stay out.
  let text = "";
  for (let i = map.thoughts.length - 1; i >= 0; i--) {
    const thought = map.thoughts[i];
    if (!thought.placed && thought.speaker === map.me && thought.text.trim()) {
      text = thought.text;
      break;
    }
  }
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
    <div className="tiny-transcript-text" style={{ fontSize: size }}>{shown}</div>
  </div>;
}
