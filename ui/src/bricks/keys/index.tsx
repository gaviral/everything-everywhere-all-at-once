// Keys (docs/bricks.md, an input): the map from the keyboard. j/↓ and k/↑ walk the points of a thread, l/→ and h/← the
// threads in the order they were made (as "next one" goes); Enter shows the point's details, Esc lets go, ? shows the
// keys. ⌘D (Ctrl+D off a Mac) starts or stops listening, as Google Meet's does. Keys typed in a field stay the field's,
// and the Palace or a view brick keeps its own arrows; Esc and Enter stay the page's when the brick has nothing to act on.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrickProps, MapSnapshot } from "../contract";
import "./keys.css";

const HINTED = "e2a2o.brick.keys.hinted";
let seenThisVisit = false;
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MIC_KEY = MAC ? "⌘D" : "Ctrl+D";
type Cursor = { threadId: string; pointId: string | null; details: boolean };
const directions: Record<string, number> = {
  j: 1, ArrowDown: 1, k: -1, ArrowUp: -1,
  l: 1, ArrowRight: 1, h: -1, ArrowLeft: -1,
};
const clamp = (n: number, length: number) => Math.max(0, Math.min(length - 1, n));
// ⌘D on a Mac, Ctrl+D elsewhere (Ctrl+D in a Mac's text field deletes forward, so it stays the field's).
const micKey = (event: KeyboardEvent) => event.key.toLowerCase() === "d" && !event.altKey && !event.shiftKey &&
  (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
// A control keeps its Enter; a card's own toggle, where the map puts focus as it opens a thread, doesn't.
const CONTROL = "button:not(.thread-toggle), a[href], summary, [role='button'], [role='switch'], [role='link']";

// A continuation replaces its earlier words on the map; navigate those visible points,
// retaining the original parts for details. Bad links cannot hide points or create loops.
function pointsIn(map: MapSnapshot, threadId: string) {
  const thoughts = map.thoughts.filter((t) => t.placed && t.thread_id === threadId);
  const at = new Map(thoughts.map((t, i) => [t.id, i]));
  const carriers = new Map<string, string>();
  for (const t of thoughts) {
    const head = map.notes[t.id]?.continues;
    if (head && (at.get(head) ?? Infinity) < at.get(t.id)! && !carriers.has(head)) carriers.set(head, t.id);
  }
  return thoughts.filter((t) => !carriers.has(t.id)).map((thought) => {
    const parts = [thought];
    let head = map.notes[thought.id]?.continues;
    while (head && carriers.get(head) === parts[0].id) {
      const part = thoughts[at.get(head)!];
      parts.unshift(part);
      head = map.notes[part.id]?.continues;
    }
    return { thought, parts };
  });
}

// The point on the map, focused (the map's own ring) and in view, after the map has opened its thread.
const reveal = (pointId: string | null) => requestAnimationFrame(() => {
  const point = pointId ? document.getElementById(`point-${pointId}`) : null;
  if (!point) return;
  point.focus({ preventScroll: true });
  point.scrollIntoView({ block: "nearest" });
});

export default function Keys({ map, actions }: BrickProps) {
  const [hint, setHint] = useState(() => {
    try { return !seenThisVisit && localStorage.getItem(HINTED) !== "1"; }
    catch { return !seenThisVisit; }
  });
  const [selected, setSelected] = useState<Cursor | null>(null);
  const cursor = useRef<Cursor | null>(null);
  const previousActive = useRef(map.active);
  const choose = (next: Cursor | null) => { cursor.current = next; setSelected(next); };
  const clear = () => { choose(null); actions.select(null); };

  useEffect(() => {
    seenThisVisit = true;
    try { localStorage.setItem(HINTED, "1"); } catch { /* Storage may be unavailable. */ }
  }, []);

  // A tap or click hides the hint too (a phone has no keys), but not one in a dialog: the Catalog's ×, which closes
  // it after switching the brick on, would hide the hint before it was ever seen.
  useEffect(() => {
    if (!hint) return;
    const down = () => { if (!document.querySelector("dialog[open], [aria-modal='true']")) setHint(false); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [hint]);

  // Follow external thread changes, and forget anything removed from the snapshot.
  useLayoutEffect(() => {
    const current = cursor.current;
    if (current && ((!map.threads.some((t) => t.id === current.threadId)) ||
      (previousActive.current !== map.active && current.threadId !== map.active))) choose(null);
    else if (current?.pointId && !pointsIn(map, current.threadId).some((p) => p.thought.id === current.pointId)) {
      choose({ ...current, pointId: null, details: false });
    }
    previousActive.current = map.active;
  }, [map]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      // ⌘D switches the mic from anywhere, a field too, as the mic's button does (a key press is a gesture in this
      // tab); held down, it switches once. The browser's bookmark shortcut is kept from firing.
      if (micKey(event)) {
        event.preventDefault();
        if (!event.repeat) actions.listen();
        setHint(false);
        return;
      }
      // A dialog keeps every key, and the hint stays up for when it closes.
      if (document.querySelector("dialog[open], [aria-modal='true']")) return;
      // Any other key hides the hint, typing too, without taking that key away from its field.
      setHint(false);
      const path = event.composedPath();
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ||
        path.some((el) => el instanceof HTMLElement && (el.isContentEditable ||
          el.matches("input, textarea, select, [contenteditable], [role='textbox']")))) return;
      if (event.key === "Tab") { choose(null); return; }
      if (event.shiftKey && event.key !== "?") return;
      const direction = directions[event.key];
      const current = cursor.current;
      if (!direction && event.key !== "?" && event.key !== "Escape" && event.key !== "Enter") return;
      // Nothing of the brick's is up: Esc stays the page's (it folds the quiet threads, closes the ? list).
      if (event.key === "Escape" && !current && !hint) return;
      if (event.key === "Enter" && (!current?.pointId || path.some((el) => el instanceof HTMLElement && el.matches(CONTROL)))) return;
      // The Palace and view bricks move with their own arrows; the keys are the map's.
      if (direction && document.querySelector("main.palace, main.brick-view")) return;
      // Capture before the app's existing j/k/? handlers so each key acts once.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "?") { if (!event.repeat) setHint(!hint); return; }
      if (event.key === "Escape") { if (current) clear(); return; }
      if (event.key === "Enter") {
        choose({ ...current!, details: true });
        actions.openThread(current!.threadId);
        reveal(current!.pointId);
        return;
      }
      if (!map.threads.length) return;
      const horizontal = ["h", "l", "ArrowLeft", "ArrowRight"].includes(event.key);
      let index = map.threads.findIndex((t) => t.id === (current?.threadId ?? map.active));
      if (horizontal) index = index < 0 ? (direction > 0 ? 0 : map.threads.length - 1) : clamp(index + direction, map.threads.length);
      else if (index < 0) index = 0;
      const thread = map.threads[index];
      if (horizontal && current?.threadId === thread.id) return;
      const points = pointsIn(map, thread.id);
      const was = current?.threadId === thread.id ? points.findIndex((p) => p.thought.id === current.pointId) : -1;
      const pointIndex = horizontal ? 0 : was < 0 ? (direction > 0 ? 0 : points.length - 1) : clamp(was + direction, points.length);
      const pointId = points[pointIndex]?.thought.id ?? null;
      choose({ threadId: thread.id, pointId, details: false });
      actions.select(thread.id);
      if (horizontal || !current || current.threadId !== thread.id) actions.openThread(thread.id);
      reveal(pointId);
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [map, actions, hint]);

  const thread = map.threads.find((t) => t.id === selected?.threadId);
  const points = thread ? pointsIn(map, thread.id) : [];
  const index = points.findIndex((p) => p.thought.id === selected?.pointId);
  const point = points[index];
  const note = point && map.notes[point.thought.id];
  if (!hint && !thread) return null;
  return <aside className="keys-panel" aria-label="Map keyboard navigation">
    {hint ? <div role="status">
      <strong>Move around the map</strong>
      <p><kbd>j ↓</kbd> next point · <kbd>k ↑</kbd> previous point</p>
      <p><kbd>l →</kbd> next thread · <kbd>h ←</kbd> previous thread</p>
      <p><kbd>Enter</kbd> details · <kbd>Esc</kbd> clear · <kbd>?</kbd> these keys</p>
      <p><kbd>{MIC_KEY}</kbd> start or stop listening</p>
      <small>Any key or tap hides this. Typing stays yours.</small>
    </div> : <>
      <div className="keys-heading">
        <strong>{thread?.title}</strong>
        <button type="button" onClick={clear} aria-label="Clear keyboard selection">×</button>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <small>{point ? `Point ${index + 1} of ${points.length}` : points.length ? "j / k to choose a point" : "No points in this thread"}</small>
        {point && <p className={selected?.details ? "keys-point" : "keys-preview"}>{point.thought.point || point.thought.text}</p>}
      </div>
      {point && selected?.details && <div className="keys-details">
        <small>Words said · {point.thought.speaker}</small>
        <p>{point.parts.map((t) => `“${t.text.trim()}”`).join(" … ")}</p>
        {note?.why && <p>{note.why}</p>}
        {note?.assumed && <p>Assumed: {note.assumed}</p>}
      </div>}
      <small>Enter for details · Esc to clear · ? for keys · {MIC_KEY} to listen</small>
    </>}
  </aside>;
}
