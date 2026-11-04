import { usePluginState } from "../contract";
import { useEffect, useId, useRef, useState } from "react";
import { useBrickEvent, type BrickEvents, type BrickProps } from "../contract";
import pluginStyle0 from "./notice-timeline.css?inline";

// What just happened: every notice and map update this window shows while the brick is on (`on("notice")`), newest
// first, behind a small clock above the dock. A notice is up only for its reading time, so one missed while looking
// away gets a second look here. Typing or saying "what just happened?" opens the list too: the core reads it as a
// command, never a point, and tells only your windows (`on("asked")`).

/** How many it keeps: the newest. */
const KEPT = 50;

type Kept = BrickEvents["notice"] & { n: number };

/** How long ago, as a person says it: "just now", "4 min ago", "2 hr ago", "1 day ago". */
function ago(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export default function NoticeTimeline({ on }: BrickProps) {
  const [kept, setKept] = usePluginState<Kept[]>('notice-timeline/index.tsx:kept', []);
  const count = useRef(Math.max(0, ...kept.map(entry => entry.n)));
  useBrickEvent(on, "notice", (notice) => {
    if (!notice.text.trim()) return;
    const entry = { ...notice, n: ++count.current };
    setKept((was) => [entry, ...was].slice(0, KEPT));
  });

  // Opened from the clock, the list takes focus, so arrows scroll it; opened by the ask, focus stays where you type.
  const [open, setOpen] = usePluginState<"clock" | "ask" | null>('notice-timeline/index.tsx:open', null);
  useBrickEvent(on, "asked", ({ what }) => { if (what === "notices") setOpen("ask"); });

  const root = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [now, setNow] = useState(Date.now);
  /** Closes the list; focus that was in it goes back to the clock. */
  const close = () => {
    if (root.current?.contains(document.activeElement)) clock.current?.focus({ preventScroll: true });
    setOpen(null);
  };
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    // Its times stay true while it's open: the finest says minutes.
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    if (open === "clock") list.current?.focus({ preventScroll: true });
    // Esc closes the list before anything under it hears the key (the map lets go of its threads on Esc); a dialog
    // open over it (the Catalog, Recap) keeps its own Esc, as it does from the map (App.tsx).
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open]);

  // No clock until there's something to look back at; the ask still opens the list, empty, and says so.
  return <div ref={root} className="notice-timeline">
    {kept.length > 0 && <button ref={clock} type="button" className="notice-timeline-clock" aria-label="What just happened?" title="What just happened?"
      aria-expanded={!!open} aria-controls={open ? listId : undefined} onClick={() => setOpen((was) => (was ? null : "clock"))}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <circle cx="8" cy="8" r="6" /><path d="M8 4v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>}
    {open && <div ref={list} id={listId} className="notice-timeline-panel" role="region" aria-label="What just happened" tabIndex={-1}>
      <div className="notice-timeline-top">
        <strong>What just happened?</strong>
        <button type="button" className="notice-timeline-close" aria-label="Close" onClick={close}>×</button>
      </div>
      {kept.length ? <ol className="notice-timeline-list">
        {kept.map((entry) => <li key={entry.n} className="notice-timeline-entry" data-kind={entry.kind}>
          <p className="notice-timeline-text">{entry.text}</p>
          <time className="notice-timeline-time" dateTime={new Date(entry.time).toISOString()} title={new Date(entry.time).toLocaleString()}>{ago(entry.time, now)}</time>
        </li>)}
      </ol> : <p className="notice-timeline-empty">Nothing yet. Notices show here once they come.</p>}
    </div>}
  </div>;
}

/** Host attaches these styles only for this mount. */
export const styles = pluginStyle0;
