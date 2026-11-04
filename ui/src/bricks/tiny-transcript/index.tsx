import { usePluginState } from "../contract";
// Tiny transcript (docs/bricks.md, a panel): your words as you say them, very small, in the place you'd type them, so
// you stay in the thought rather than the reading. Where: the status line, once the page has one flush at its very
// bottom (`data-slot="status"`, the revamp's shell); else inside the composer's box, where its "Or type a thought"
// sits, which steps aside while your words show (above the box instead while you've typed something there yourself);
// with no composer (the playground), just above the bottom. They're `map.partial`, and brick.json's `showsLiveWords`
// takes them from the dock's big live line, so they never show twice. The newest words are said a shade stronger, with
// a still caret where the next will come. At a turn's end its words stay until its thought comes, a moment at most, so
// they turn into the thought where they were (the bubble flight lifts it from the same box). The first time, a hint
// says what this is, with a labelled size slider.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { BrickProps } from "../contract";
import pluginStyle0 from "./tiny-transcript.css?inline";

const HINTED = "e2a2o.brick.tiny-transcript.hinted";
const SIZE = "e2a2o.brick.tiny-transcript.size";
/** At a turn's end, its words wait for its thought this long at most: as long as the dock's own line holds them
 *  (core.ts, its hand-off), past which the thought is late and the words have nothing to turn into. */
const HANDOFF_MS = 1500;
/** The newest words, said stronger: the last few, what you're saying now. */
const NEWEST = 3;
/** A hint's room to its thing, past the tail. */
const GAP = 10;

type Box = { left: number; top: number; width: number; height: number };
/** Where the words show: in the status line; in the composer's box, over its field; or floating just above the box
 *  (`bottom`, px from the window's foot; null: the CSS's own, above the dock). */
type Place = { at: "status"; slot: Element } | { at: "box"; box: Box; field: Box } | { at: "float"; bottom: number | null };

function readSetting(key: string) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function saveSetting(key: string, value: string) {
  // The transcript and its controls still work when browser storage is unavailable.
  try { localStorage.setItem(key, value); }
  catch { /* Keep the setting for this mount through React state. */ }
}

const boxOf = (rect: DOMRect): Box => ({ left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) });

/** Where the words go now. The status line only when it's flush at the window's foot: today's header carries the name
 *  `status` at the top, where the words would be far from your eyes. */
function placeNow(): Place {
  const status = document.querySelector('[data-slot="status"]');
  const line = status?.getBoundingClientRect();
  if (status && line && line.height > 0 && line.bottom >= innerHeight - 2) return { at: "status", slot: status };
  const composer = document.querySelector(".composer");
  const box = composer?.getBoundingClientRect();
  if (!composer || !box || !box.height) return { at: "float", bottom: null };
  const field = composer.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input:not([type=hidden])");
  const area = field?.getBoundingClientRect();
  // Your own typing keeps the box: the words wait just above it.
  if (!field || !area || area.width < 48 || field.value.trim()) return { at: "float", bottom: Math.round(innerHeight - box.top + 8) };
  return { at: "box", box: boxOf(box), field: boxOf(area) };
}

const samePlace = (a: Place, b: Place) => a.at === "status" || b.at === "status"
  ? a.at === "status" && b.at === "status" && a.slot === b.slot
  : JSON.stringify(a) === JSON.stringify(b);

/** The place, kept current while there are words to show (`watching`): once a frame, as the layout may move under them
 *  (the box resizing, the status line arriving, typing starting), changing only when it does. */
function usePlace(watching: boolean): Place {
  const [place, setPlace] = useState<Place>(() => (watching ? placeNow() : { at: "float", bottom: null }));
  const last = useRef(place);
  useLayoutEffect(() => {
    if (!watching) return;
    let frame = 0;
    const look = () => {
      const now = placeNow();
      if (!samePlace(now, last.current)) { last.current = now; setPlace(now); }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [watching]);
  return place;
}

/** The words, the newest few apart: said stronger, with the caret after them while you're still talking. */
function Words({ text, live, size, style }: { text: string; live: boolean; size: number; style?: CSSProperties }) {
  const parts = text.split(/(\s+)/);
  // Words and the spaces between them alternate; the newest words are the last NEWEST of them, spaces between included.
  const cut = Math.max(0, parts.length - (2 * NEWEST - 1));
  const said = parts.slice(0, cut).join("");
  const now = parts.slice(cut).join("");
  // The words in an isolate of their own: the line runs from its end (the CSS), and they keep their own order.
  return <div className="tiny-transcript-text" style={{ ...style, fontSize: size }}>
    <bdi>{said && <span className="tiny-transcript-said">{said}</span>}<span className={live ? "tiny-transcript-now tiny-transcript-live" : "tiny-transcript-now"}>{now}</span></bdi>
  </div>;
}

export default function TinyTranscript({ map }: BrickProps) {
  const [size, setSize] = usePluginState('tiny-transcript/index.tsx:size', () => {
    const saved = Number(readSetting(SIZE));
    return Number.isInteger(saved) && saved >= 9 && saved <= 16 ? saved : 11;
  });
  const [hinted, setHinted] = usePluginState('tiny-transcript/index.tsx:hinted', () => readSetting(HINTED) !== null);
  // The words the hint first showed with: they stay up with it once the turn ends and its words go, so there's time
  // to try the slider; the hint goes only when dismissed.
  const [held, setHeld] = useState("");
  const hint = useRef<HTMLDivElement>(null);
  const statusWords = useRef<HTMLDivElement>(null);
  const [hintPosition, setHintPosition] = useState<{ left: number; top: number; tail: number } | null>(null);

  // Only ever yours: the core sends a speaker's live words to that speaker's windows alone.
  const text = map.partial.trim();
  useEffect(() => { if (text && !hinted) setHeld(text); }, [text, hinted]);

  // A turn's end: its words stay until its thought comes (one more of yours on the map), HANDOFF_MS at most; not when
  // one already came while you spoke (it's in the air already).
  const mine = map.thoughts.reduce((n, thought) => n + (thought.speaker === map.me ? 1 : 0), 0);
  const [ending, setEnding] = useState("");
  const turn = useRef({ words: "", mine });
  useEffect(() => {
    if (text) {
      if (!turn.current.words) turn.current.mine = mine;
      turn.current.words = text;
      setEnding("");
      return;
    }
    const { words, mine: before } = turn.current;
    turn.current.words = "";
    if (!words || mine > before) return;
    setEnding(words);
    const timer = window.setTimeout(() => setEnding(""), HANDOFF_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(() => { if (mine > turn.current.mine) setEnding(""); }, [mine]);

  // Keep the optional size hint clear of the conversation's stop controls.
  const partnerOn = !!map.partnerOn;
  const showHint = !partnerOn && !hinted && !!(text || held);
  const shown = text || ending || (showHint ? held : "");
  const place = usePlace(!!shown);

  // The status clips its children. Its hint lives on the page instead, following the actual words' rectangle as the
  // mic's clock and History change width. Measure the hint too: its label and slider must fit a narrow viewport.
  useLayoutEffect(() => {
    if (!showHint || place.at !== "status") { setHintPosition(null); return; }
    let frame = 0;
    const look = () => {
      const words = statusWords.current?.getBoundingClientRect();
      const tip = hint.current?.getBoundingClientRect();
      if (words && tip) {
        const left = Math.max(GAP, Math.min(words.left, innerWidth - tip.width - GAP));
        const top = Math.max(GAP, Math.min(words.top - GAP - tip.height, innerHeight - tip.height - GAP));
        const tail = Math.max(GAP, Math.min(words.left + 22 - left, tip.width - GAP));
        setHintPosition((before) => before?.left === left && before.top === top && before.tail === tail ? before : { left, top, tail });
      }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [showHint, place]);

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

  const tip = place.at === "status" ? "tiny-transcript-hint tiny-transcript-hint-in-status"
    : place.at === "float" ? "tiny-transcript-hint tiny-transcript-hint-center" : "tiny-transcript-hint";
  const hintAt: CSSProperties | undefined = place.at === "status"
    ? { left: hintPosition?.left, top: hintPosition?.top, visibility: hintPosition ? "visible" : "hidden", "--tiny-transcript-tail": `${hintPosition?.tail ?? 22}px` } as CSSProperties
    : place.at === "box" ? { left: place.field.left - place.box.left - 14, bottom: `calc(100% + ${GAP}px)` } : undefined;
  const hintShown = showHint && <div className={tip} style={hintAt} ref={hint} data-hint="tiny-transcript">
    <p className="tiny-transcript-help">Your words as you speak, kept small; slide to resize</p>
    <label className="tiny-transcript-size-row">
      <span className="tiny-transcript-size-label">Text size</span>
      <input className="tiny-transcript-size" type="range" min="9" max="16" step="1" value={size} aria-valuetext={`${size} pixels`}
        data-guide="tiny-transcript:size"
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setSize(next);
          saveSetting(SIZE, String(next));
        }} />
      <span className="tiny-transcript-size-value" aria-hidden="true">{size} px</span>
    </label>
  </div>;

  if (place.at === "status") {
    return <>
      {createPortal(<div className="tiny-transcript tiny-transcript-in-status" ref={statusWords}><Words text={shown} live={!!text} size={size} /></div>, place.slot)}
      {showHint && createPortal(hintShown, document.body)}
    </>;
  }
  if (place.at === "box") {
    const { box, field } = place;
    // Over the box's field, on the box's own color: the box's hint is under the words, not beside them.
    return <div className="tiny-transcript tiny-transcript-in-box" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      {hintShown}
      <Words text={shown} live={!!text} size={size}
        style={{ left: field.left - box.left, top: field.top - box.top, width: field.width, height: field.height, lineHeight: `${field.height}px` }} />
    </div>;
  }
  return <div className="tiny-transcript tiny-transcript-floating" style={place.bottom === null ? undefined : { bottom: place.bottom }}>
    {hintShown}
    <Words text={shown} live={!!text} size={size} />
  </div>;
}

/** Host attaches these styles only for this mount. */
export const styles = pluginStyle0;
