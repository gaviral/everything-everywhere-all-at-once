import { useEffect, useId, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import "./countdown.css";

// Your deadlines in a corner, nearest first: the next two as "<label> in 21 h 14 m" (a phone shows the nearest only),
// amber in the last three hours. A click or Enter opens a small editor; every change is kept in this browser at once
// (`localStorage`), and the brick works the same when storage throws. Stored dates are instants; the editor presents
// them in this browser's local time.
type Deadline = { label: string; at: string };
const STORE = "e2a2o.countdown";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Under this much time left a deadline is amber: time to act. */
const SOON = 3 * HOUR;

function readDeadlines(): Deadline[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(saved) ? saved.filter((entry): entry is Deadline =>
      !!entry && typeof entry === "object" && typeof entry.label === "string" &&
      typeof entry.at === "string" && (entry.at === "" || Number.isFinite(Date.parse(entry.at)))) : [];
  } catch { return []; }
}

/** How long is left, as a person says it: "in 2 d 5 h" over 48 h, "in 21 h 14 m" from an hour, "in 42 min" under it.
 *  Whole minutes, rounded down: it never says more time than there is ("in 60 min" can't happen), and the last minute
 *  says 1, never 0. */
function remaining(ms: number) {
  if (ms < HOUR) return `in ${Math.max(1, Math.floor(ms / MINUTE))} min`;
  const hours = Math.floor(ms / HOUR);
  if (ms > 48 * HOUR) return `in ${Math.floor(hours / 24)} d ${hours % 24} h`;
  return `in ${hours} h ${Math.floor(ms / MINUTE) % 60} m`;
}

/** An instant as a datetime-local field wants it: this browser's local time, to the minute. */
function localTime(at: string) {
  if (!at) return "";
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function Countdown(_props: BrickProps) {
  const [deadlines, setDeadlines] = useState(readDeadlines);
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  /** Where focus goes once the editor shows the change: opened, the first label; a new row, its label; a removal,
   *  the Add button (the removed row's button is gone, and the first label would be a jump). */
  const focus = useRef<"first" | "last" | "add">("first");
  const editorId = useId();

  const save = (next: Deadline[]) => {
    setDeadlines(next);
    setNow(Date.now());
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* Keep working in memory. */ }
  };
  const add = () => {
    focus.current = "last";
    // An hour ahead, to the minute: the field has no seconds, so the countdown and the field say the same time.
    save([...deadlines, { label: "", at: new Date(Math.ceil((Date.now() + HOUR) / MINUTE) * MINUTE).toISOString() }]);
  };
  const change = (index: number, patch: Partial<Deadline>) => save(deadlines.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const remove = (index: number) => {
    focus.current = "add";
    save(deadlines.filter((_, i) => i !== index));
  };
  /** Closes the editor; focus that was in it goes back to the card. */
  const close = () => {
    if (root.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  };

  // The clock: every 30 s, and at once when the tab is looked at again (a hidden tab's timers run slowly).
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const fields = editor.current?.querySelectorAll<HTMLInputElement>('input[type="text"]');
    const addButton = editor.current?.querySelector<HTMLButtonElement>(".countdown-add");
    const target = focus.current === "add" || !fields?.length ? addButton : fields[focus.current === "last" ? fields.length - 1 : 0];
    target?.focus({ preventScroll: true });
    focus.current = "first";
  }, [open, deadlines.length]);

  useEffect(() => {
    if (!open) return;
    // Esc closes the editor before anything under it hears the key (the map lets go of its threads on Esc); a dialog
    // open over it (the Catalog, Recap) keeps its own Esc.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open]);

  // Past deadlines drop off; a row without a label (just added) waits for one. The nearest two show.
  const upcoming = deadlines.flatMap(({ label, at }) => {
    const left = Date.parse(at) - now;
    return label.trim() && left > 0 ? [{ label: label.trim(), left }] : [];
  }).sort((a, b) => a.left - b.left).slice(0, 2);
  const fullText = upcoming.length ? upcoming.map(({ label, left }) => `${label} ${remaining(left)}`).join(". ") : "No deadlines. Add";

  return <div ref={root} className="countdown" data-guide="countdown">
    <button ref={trigger} type="button" className="countdown-card" aria-label={`Deadlines. ${fullText}`}
      aria-expanded={open} aria-controls={open ? editorId : undefined} onClick={() => { setNow(Date.now()); setOpen(!open); }}>
      {upcoming.length ? upcoming.map(({ label, left }, i) => {
        const line = i === 0 ? "countdown-nearest" : "countdown-next";
        return <span key={i} className={left < SOON ? `${line} countdown-soon` : line}>
          <span className="countdown-label">{label}</span>{" "}
          <span className="countdown-time">{remaining(left)}</span>
        </span>;
      }) : <span className="countdown-empty">No deadlines <span className="countdown-add-label">Add</span></span>}
    </button>
    {open && <div ref={editor} id={editorId} className="countdown-editor" role="region" aria-label="Deadlines">
      <div className="countdown-top"><strong>Deadlines</strong><button type="button" className="countdown-close" aria-label="Close Deadlines" onClick={close}>×</button></div>
      <ol className="countdown-list">
        {deadlines.map((entry, i) => <li key={i} className="countdown-row">
          <label className="countdown-field countdown-what">Label
            <input type="text" value={entry.label} onChange={(event) => change(i, { label: event.target.value })} />
          </label>
          <label className="countdown-field countdown-when">Date and time
            <input type="datetime-local" value={localTime(entry.at)} onChange={(event) => {
              const date = new Date(event.target.value);
              change(i, { at: Number.isFinite(date.getTime()) ? date.toISOString() : "" });
            }} />
          </label>
          <button type="button" className="countdown-remove" aria-label={`Remove ${entry.label.trim() || "deadline"}`} onClick={() => remove(i)}>Remove</button>
        </li>)}
      </ol>
      <button type="button" className="countdown-add" onClick={add}>Add</button>
    </div>}
  </div>;
}
