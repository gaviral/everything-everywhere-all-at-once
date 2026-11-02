// The attention guide (decisions/attention.md): one highlight for "look here", the "latest" mark on your newest
// point, "New in X ↓" when the map held still, unseen marks on threads that changed out of sight, and "this" on the
// card a spoken "this" acts on. App.tsx feeds it the world and tells it what the map showed or held back.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Landing, World } from "./core";
import { carry, changes, direction, LOOK_MS, newestOwn, pointsAtThis, readMs, type Unseen } from "./attention-core";
import "./attention.css";

/** The visible band of the map: under the header and tools, above the dock. */
export function band() {
  const top = Math.max(0, ...Array.from(document.querySelectorAll("header, .map-tools"), (bar) => bar.getBoundingClientRect().bottom));
  const dock = document.querySelector(".dock")?.getBoundingClientRect().top ?? window.innerHeight;
  return { top, bottom: Math.min(window.innerHeight, dock) };
}

/** Whether an element's first line is inside the band, where it can be read. */
function readable(element: HTMLElement | null) {
  if (!element || document.visibilityState !== "visible") return false;
  const rect = element.getBoundingClientRect();
  const { top, bottom } = band();
  const line = parseFloat(getComputedStyle(element).lineHeight) || 22;
  return rect.height > 0 && rect.top >= top && Math.min(rect.bottom, rect.top + line) <= bottom;
}

/** The words a highlight asks you to read: an element's text without what's only for screen readers, the hover-only
 *  placing time, or its buttons. */
export function wordsIn(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only, .speed, button").forEach((part) => part.remove());
  return copy.textContent ?? "";
}

// One highlight at a time: a new one takes the old one down.
let current: { element: HTMLElement; frame: number; timer: number } | null = null;
/** The highlight's fade out: slow enough that its end doesn't pull the eye back (a gradual change draws far less
 *  attention than an abrupt one; Simons, Franconeri & Reimer 2000). */
export const FADE_OUT_MS = 1000;

/** "Look here": highlights `element` once it holds still (a smooth scroll or a slide into place has ended), for as long
 *  as reading `text` takes, then fades it. Every "go there" uses it: a landing, Take me there, a Recap link. */
export function look(element: HTMLElement, text = wordsIn(element)) {
  stop();
  const read = readMs(text);
  const entry = { element, frame: 0, timer: 0 };
  current = entry;
  element.dataset.look = "on";
  const started = performance.now();
  let last = NaN;
  let still = 0;
  // Two frames without moving is still; past one reading time of moving, start the clock anyway.
  const wait = () => {
    const top = element.getBoundingClientRect().top;
    still = Math.abs(top - last) < 0.5 ? still + 1 : 0;
    last = top;
    if (still >= 2 || performance.now() - started > read) {
      entry.timer = window.setTimeout(() => {
        if (current !== entry) return;
        element.dataset.look = "off";
        entry.timer = window.setTimeout(() => { if (current === entry) stop(); }, FADE_OUT_MS);
      }, read);
    } else entry.frame = requestAnimationFrame(wait);
  };
  entry.frame = requestAnimationFrame(wait);
}

function stop() {
  if (!current) return;
  cancelAnimationFrame(current.frame);
  window.clearTimeout(current.timer);
  current.element.removeAttribute("data-look");
  current = null;
}

/** The point a "look" at a thread lands on: a thought, or else the thread's head. */
export function lookAtPoint(thought: string, title: string) {
  const point = document.getElementById(`point-${thought}`);
  if (point) look(point, `${title} ${wordsIn(point)}`);
}

type Note = { thread: string; thought: string; title: string; dir: "↑" | "↓" | null };

type Value = {
  latest: string | null;
  unseen: Map<string, Unseen>;
  thisThread: string | null;
  note: Note | null;
  /** Placed thoughts already on the map before this render: a point not among them is arriving. */
  known: { current: Set<string> | null };
};

const Context = createContext<Value>({ latest: null, unseen: new Map(), thisThread: null, note: null, known: { current: null } });

/** The attention state for the map, from the world as it changes. */
export function useAttention({ world, revision, me, view, words, reveal }: {
  world: World; revision: number; me: string; view: string; words: string;
  reveal: (thread: string, thought: string | null) => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [unseen, setUnseen] = useState<Unseen[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const known = useRef<Set<string> | null>(null);
  const before = useRef<{ world: World; revision: number } | null>(null);

  useEffect(() => {
    if (!revision) return;
    const placed = world.thoughts.filter((t) => t.placed);
    const last = before.current;
    before.current = { world, revision };
    known.current = new Set(placed.map((t) => t.id));
    if (!last) {
      // A fresh page: your newest words by when you said them (a time ahead of the clock, a sample, counts least).
      const now = Date.now();
      const own = placed.filter((t) => t.speaker === me || t.speaker === "you");
      const newest = own.reduce<typeof own[number] | undefined>((a, t) => (!a || (t.at_ms > now ? 0 : t.at_ms) >= (a.at_ms > now ? 0 : a.at_ms) ? t : a), undefined);
      setLatest(newest?.id ?? null);
      return;
    }
    if (last.revision !== revision) { setUnseen((marks) => carry(marks, world)); return; }
    const wasPlaced = new Set(last.world.thoughts.filter((t) => t.placed).map((t) => t.id));
    const mine = newestOwn(placed.filter((t) => !wasPlaced.has(t.id)), me);
    if (mine) setLatest(mine);
    // A change already in view when it happens is seen happening; only what changed out of sight is marked. A
    // proposal in a folded thread already says "N to review" there: one cue per change.
    const folded = (c: Unseen) => c.element.startsWith("item-") && !!document.getElementById(`thread-${c.thread}`)?.classList.contains("collapsed");
    const fresh = view === "map" ? changes(last.world, world, me).filter((c) => !readable(document.getElementById(c.element)) && !folded(c)) : changes(last.world, world, me);
    setUnseen((marks) => carry([...marks.filter((m) => !fresh.some((f) => f.thread === m.thread)), ...fresh], world));
  }, [world, revision, me]);

  // Unseen marks clear once their change has been in view for its reading time, or when you touch the thread.
  const timers = useRef(new Map<string, number>());
  useEffect(() => {
    if (!unseen.length) return;
    let frame = 0;
    const clear = (thread: string) => setUnseen((marks) => marks.filter((m) => m.thread !== thread));
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const mark of unseen) {
          const seen = view === "map" && readable(document.getElementById(mark.element));
          const timer = timers.current.get(mark.thread);
          if (seen && timer === undefined) timers.current.set(mark.thread, window.setTimeout(() => clear(mark.thread), readMs(mark.line)));
          if (!seen && timer !== undefined) { window.clearTimeout(timer); timers.current.delete(mark.thread); }
        }
      });
    };
    const touch = (event: Event) => {
      const id = (event.target as Element | null)?.closest?.(".thread")?.id.replace(/^thread-/, "");
      if (id && unseen.some((m) => m.thread === id)) clear(id);
    };
    check();
    const resize = new ResizeObserver(check);
    resize.observe(document.body);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    document.addEventListener("visibilitychange", check);
    document.addEventListener("pointerdown", touch, true);
    document.addEventListener("focusin", touch, true);
    return () => {
      cancelAnimationFrame(frame);
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
      resize.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", check);
      document.removeEventListener("pointerdown", touch, true);
      document.removeEventListener("focusin", touch, true);
    };
  }, [unseen, view]);

  // "New in X ↓" points at a held-back landing until it's in view (then it gets the highlight), you go there, or a
  // newer landing is shown.
  useEffect(() => {
    if (!note) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (view !== "map") { setNote((n) => (n && n.dir !== null ? { ...n, dir: null } : n)); return; }
        const point = document.getElementById(`point-${note.thought}`) ?? document.getElementById(`thread-${note.thread}`);
        if (!point) return;
        if (point.id.startsWith("point-") && readable(point)) {
          setNote(null);
          look(point, `${note.title} ${wordsIn(point)}`);
          return;
        }
        const dir = direction(point.getBoundingClientRect(), band()) ?? "↓";
        if (dir !== note.dir) setNote({ ...note, dir });
      });
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [note, view]);

  const titleOf = (thread: string) => world.threads.find((t) => t.id === thread)?.title ?? "";
  const titles = useRef(titleOf);
  titles.current = titleOf;
  const thisThread = pointsAtThis(words) ? world.active : null;
  const value = useMemo<Value>(() => ({ latest, unseen: new Map(unseen.map((m) => [m.thread, m])), thisThread, note, known }), [latest, unseen, thisThread, note]);
  return {
    value,
    /** The map showed your landing: highlight it; any note is done. */
    shown: useCallback((thought: string, thread: string) => { setNote(null); lookAtPoint(thought, titles.current(thread)); }, []),
    /** The map held your landing back: say where it went. */
    held: useCallback((landing: Landing) => setNote({ thread: landing.thread, thought: landing.thought, title: titles.current(landing.thread), dir: null }), []),
    go: useCallback(() => { const n = noteRef.current; setNote(null); if (n) reveal(n.thread, n.thought); }, [reveal]),
  };
}

export function AttentionProvider({ value, children }: { value: Value; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** A point's marks: "latest" while it's your newest; arriving (a short fade in under Reduce Motion, where a slide
 *  would be a one-frame jump) when it wasn't on the map a render ago. */
export function usePointMarks(id: string) {
  const { latest, known } = useContext(Context);
  const [arriving] = useState(() => known.current !== null && !known.current.has(id));
  return { latest: latest === id, arriving };
}

/** The opacity a point arrives with: under Reduce Motion a fade as long as the eye takes to get there. */
export const ARRIVE = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { opacity: { duration: LOOK_MS / 1000, ease: "easeOut" } } } as const;

/** In a thread's head: a dot while it holds a change you haven't seen (as Mail marks unread). */
export function UnseenDot({ thread }: { thread: string }) {
  const mark = useContext(Context).unseen.get(thread);
  if (!mark) return null;
  return <span className="unseen-dot" role="img" aria-label={`Changed since you looked: ${mark.line}`} title={`New since you looked: ${mark.line}`} />;
}

/** On a card's edge: "this", while the words being said point at it. */
export function ThisTag({ thread }: { thread: string }) {
  return useContext(Context).thisThread === thread ? <span className="this-tag" aria-hidden="true">this</span> : null;
}

/** After the live words: what "this" will act on, as the words point at it. */
export function ThisEcho({ title }: { title: string }) {
  return useContext(Context).thisThread ? <span className="this-echo"> · this: {title}</span> : null;
}

/** In the dock: where your held-back landing went. */
export function AttentionNote({ onGo }: { onGo: () => void }) {
  const note = useContext(Context).note;
  if (!note || !note.title) return null;
  return <button className="attention-note" onClick={onGo}>New in {note.title}{note.dir ? ` ${note.dir}` : ""}</button>;
}
