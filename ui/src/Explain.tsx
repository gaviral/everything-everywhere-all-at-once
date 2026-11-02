import { useEffect, useLayoutEffect, useRef, useState } from "react";

// crypto.randomUUID needs a secure page; a guest laptop in a room loads plain http from the LAN.
const newId = () => (window.isSecureContext && crypto.randomUUID ? crypto.randomUUID() : `x${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
import type { Explanation } from "./core";
import { TIPS } from "./Tips";

// A word, a phrase or a sentence; longer selections are usually for copying.
const LONGEST = 160;
// The core gives up after 20 seconds, so an answer missing after this was lost on the way (a reconnect).
const PATIENCE_MS = 25_000;

type Picked = { id: string; text: string; context: string; threadId: string | null; range: Range; touch: boolean; asked: boolean };

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const control = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest("button, a, input, textarea, select, summary, [contenteditable]");

// Select a word or phrase on the map to get it explained in its thread.
export function Explain({ explanations, explain, mark }: {
  explanations: Record<string, Explanation>;
  explain: (id: string, text: string, context: string, threadId: string | null) => boolean;
  /** Marks an answer as off, or takes the mark back; false when it couldn't be sent. */
  mark: (kind: "explain", id: string, off: boolean) => boolean;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  // Answers marked off in this window, so the toggle shows its state while the card is open.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const toggleOff = (id: string) => {
    const next = !off.has(id);
    if (!mark("explain", id, next)) return;
    setOff((marked) => { const copy = new Set(marked); if (next) copy.add(id); else copy.delete(id); return copy; });
  };
  const [lost, setLost] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const current = useRef(picked);
  current.current = picked;
  // The selection last shown or dismissed, so it doesn't pop back on the next key.
  const seen = useRef<Range | null>(null);

  const ask = (target: Picked) => {
    const id = newId();
    const moveFocus = !!box.current?.contains(document.activeElement);
    setPicked({ ...target, id, asked: true });
    if (!explain(id, target.text, target.context, target.threadId)) setLost(id);
    if (moveFocus) requestAnimationFrame(() => dismiss.current?.focus());
  };
  const asking = useRef(ask);
  asking.current = ask;

  // Above the phrase, between the sticky bars at the top and the dock; below it when there's no room
  // above, and for touch, where the system's own menu sits above. Gone once the phrase scrolls away.
  const place = () => {
    const open = current.current;
    const element = box.current;
    if (!open || !element) return;
    const anchor = open.range.getBoundingClientRect();
    const ceiling = Math.max(0, ...Array.from(document.querySelectorAll("header, .map-tools"), (bar) => bar.getBoundingClientRect().bottom));
    const floor = document.querySelector(".dock")?.getBoundingClientRect().top ?? window.innerHeight;
    if (!anchor.width && !anchor.height && open.asked) return;
    if ((!anchor.width && !anchor.height) || anchor.bottom < ceiling || anchor.top > floor) return setPicked(null);
    const gap = 8;
    const { offsetWidth: width, offsetHeight: height } = element;
    const fitsAbove = anchor.top - gap - height >= ceiling + gap;
    const fitsBelow = anchor.bottom + gap + height <= floor - gap;
    const below = open.touch ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    element.style.left = `${Math.max(gap, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - gap))}px`;
    element.style.top = `${below ? anchor.bottom + gap : anchor.top - gap - height}px`;
  };
  // After every render, so the box follows the phrase as the live map moves around it.
  useLayoutEffect(place);

  useEffect(() => {
    const pick = (touch: boolean) => {
      const selection = window.getSelection();
      const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const node = range?.commonAncestorContainer;
      const element = node instanceof Element ? node : node?.parentElement;
      if (!range || !text || text.length > LONGEST || !element?.closest(".map")) {
        // A bare button goes with its selection; an answer stays until dismissed.
        if (!current.current?.asked) setPicked(null);
        seen.current = null;
        return;
      }
      const last = seen.current;
      if (last && last.toString() === range.toString() && last.compareBoundaryPoints(Range.START_TO_START, range) === 0) return;
      seen.current = range.cloneRange();
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const around = element.textContent ?? "";
      const context = element.closest("li")?.getAttribute("title") || (around.length < 300 ? around : text);
      const threadId = element.closest(".thread")?.id.replace(/^thread-/, "") || null;
      setPicked({ id: newId(), text, context, threadId, range: seen.current, touch, asked: false });
    };
    const outside = (event: Event) => !box.current?.contains(event.target as Node);
    const onPointerUp = (event: PointerEvent) => {
      if (outside(event)) window.setTimeout(() => pick(event.pointerType === "touch"));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!outside(event)) return;
      setPicked(null);
      seen.current = null;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if ((event.shiftKey || event.key === "Shift") && !typing(event.target)) pick(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const open = current.current;
      if (!open) return;
      if (event.key === "Escape") {
        // This Escape is for the box only: don't also fold the map's quiet threads.
        if (!typing(event.target)) event.stopPropagation();
        if (box.current?.contains(document.activeElement)) previous.current?.focus({ preventScroll: true });
        setPicked(null);
      } else if (event.key === "Enter" && !open.asked && !control(event.target)) {
        event.preventDefault();
        asking.current(open);
      }
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, []);

  const answer = picked ? explanations[picked.id] : undefined;
  useEffect(() => {
    if (!picked?.asked || answer) return;
    const id = picked.id;
    const timer = window.setTimeout(() => setLost(id), PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [picked?.id, picked?.asked, answer]);

  if (!picked) return null;
  const failed = answer?.failed || lost === picked.id;
  return (
    <div ref={box} className="explain">
      {!picked.asked ? (
        <button onClick={() => ask(picked)} title="Explain (Enter)" aria-keyshortcuts="Enter">
          Explain “{picked.text.length > 24 ? `${picked.text.slice(0, 24)}…` : picked.text}”
        </button>
      ) : (
        <div className="explain-card">
          <div role="status">{failed ? (
            <>
              {answer?.failed ? answer.text : "Couldn't explain that just now."}
            </>
          ) : answer ? (
            <>
              <span className="ai-mark" role="img" aria-label="AI explanation" data-tip={TIPS.explanation}>✦</span> {answer.text}
            </>
          ) : (
            <span className="explain-wait">Explaining…</span>
          )}</div>
          <span className="explain-actions">
            {failed && <button onClick={() => ask(picked)}>Try again</button>}
            {answer && !failed && <button className="explain-off" aria-pressed={off.has(picked.id)} onClick={() => toggleOff(picked.id)}
              title={off.has(picked.id) ? "Marked off. Click to take it back." : "Off the mark? Note it, so explanations improve."}>
              {off.has(picked.id) ? "Marked off" : "Off?"}
            </button>}
            <button ref={dismiss} className="quiet" onClick={() => { previous.current?.focus({ preventScroll: true }); setPicked(null); }} aria-label="Dismiss explanation">×</button>
          </span>
        </div>
      )}
    </div>
  );
}
