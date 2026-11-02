import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Thought, Thread } from "./core";
import { moveTargets, typedTitle } from "./moves-core";
import "./moves.css";

// Move and rename on the map (core/src/moves.rs): a point's Move opens a list of threads to send it to (type to narrow
// it, as Things' Move does), or drag Move onto a card; a click on a title renames the thread. Both answer with a notice
// that carries Undo, as saying "move that to …" or "rename this to …" does: one definition for both (catalog.rs).
type Moves = { threads: Thread[]; move: (thoughtId: string, threadId: string | null) => void; rename: (threadId: string, title: string) => void };
const MovesContext = createContext<Moves | null>(null);

export function MovesProvider({ threads, move, rename, children }: Moves & { children: ReactNode }) {
  const value = useMemo(() => ({ threads, move, rename }), [threads, move, rename]);
  return <MovesContext.Provider value={value}>{children}</MovesContext.Provider>;
}

/** What a dragged point carries: its id, under a type only this map reads, so a drag from elsewhere moves nothing. */
export const DRAG_TYPE = "application/x-e2a2o-thought";

/** A point's Move: a click opens the list, a drag drops it on another card. */
export function MovePoint({ thought }: { thought: Thought }) {
  const moves = useContext(MovesContext);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!moves) return null;
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  return (
    <span className="move-point">
      <button ref={button} type="button" className="move-button" draggable aria-expanded={open} aria-haspopup="true"
        aria-label={`Move “${thought.point}” to another thread`}
        onClick={() => setOpen((was) => !was)}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, thought.id);
          event.dataTransfer.effectAllowed = "move";
          // The point itself shows under the pointer, not the small button.
          const point = event.currentTarget.closest("li");
          if (point) event.dataTransfer.setDragImage(point, 16, 12);
          document.body.classList.add("moving-point");
        }}
        onDragEnd={() => document.body.classList.remove("moving-point")}>Move</button>
      {open && <MoveMenu current={thought.thread_id} threads={moves.threads} pick={(to) => { close(true); moves.move(thought.id, to); }} close={close} />}
    </span>
  );
}

/** The list a Move opens: a field to narrow it, the threads touched last first, and a new thread at the end. Enter
 *  takes the first match, arrows walk the list, Esc or a click outside closes it. */
function MoveMenu({ current, threads, pick, close }: { current: string | null; threads: Thread[]; pick: (to: string | null) => void; close: (refocus: boolean) => void }) {
  const [query, setQuery] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const targets = moveTargets(threads, current, query);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [close]);
  const walk = (event: React.KeyboardEvent, step: number) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("input, .move-list > button") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, at + step))]?.focus();
    event.preventDefault();
  };
  return (
    <div ref={menu} className="move-menu" role="dialog" aria-label="Move to another thread"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(true); }
        if (event.key === "ArrowDown") walk(event, 1);
        if (event.key === "ArrowUp") walk(event, -1);
      }}>
      <input autoFocus value={query} placeholder="Move to…" aria-label="Move to a thread: type to narrow the list"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); pick(targets[0]?.id ?? null); } }} />
      {/* Buttons, not a list: inside a point, a list's items would take the point's own bullet and spacing. */}
      <div className="move-list">
        {targets.map((t) => <button key={t.id} type="button" onClick={() => pick(t.id)}>{t.title}</button>)}
        <button type="button" className="new" onClick={() => pick(null)}>New thread</button>
      </div>
    </div>
  );
}

/** Props that make a card take a point dropped on it (the innermost card under the pointer). */
export function useDropPoint(thread: string) {
  const moves = useContext(MovesContext);
  const [over, setOver] = useState(false);
  const carries = (event: React.DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);
  // A drop on a branch inside this card (or a drag given up) ends the drag here too: the branch keeps the drop to
  // itself, and the pointer never left this card, so nothing else would clear its highlight.
  useEffect(() => {
    if (!over) return;
    const end = () => setOver(false);
    document.addEventListener("drop", end, true);
    document.addEventListener("dragend", end, true);
    return () => {
      document.removeEventListener("drop", end, true);
      document.removeEventListener("dragend", end, true);
    };
  }, [over]);
  return {
    over,
    props: {
      onDragOver: (event: React.DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: React.DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        document.body.classList.remove("moving-point");
        moves?.move(event.dataTransfer.getData(DRAG_TYPE), thread);
      },
    },
  };
}

/** A thread's title; a click (or Enter on it) edits it in place. Enter or leaving the field keeps the new title, Esc
 *  keeps the old one, and an unchanged or empty title sends nothing. */
export function ThreadTitle({ thread, depth }: { thread: Thread; depth: number }) {
  const moves = useContext(MovesContext);
  const [editing, setEditing] = useState(false);
  const done = useRef(false);
  // The title when the edit began: a rename that lands meanwhile (the AI's tidy-up, someone in the room) is kept
  // when the field is left as it was, not reverted to the old words still in it.
  const before = useRef(thread.title);
  // Enter or Esc ends the edit from the keyboard: focus goes back to the title, so Enter edits it again and j/k carry
  // on from its card. Leaving the field by click or Tab keeps focus where it went.
  const refocus = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);
  const heading = { className: "title", id: `title-${thread.id}`, role: "heading", "aria-level": Math.min(depth, 6) } as const;
  if (!moves) return <div {...heading}>{thread.title}</div>;
  const finish = (typed: string | null) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const title = typed === null ? null : typedTitle(typed, before.current);
    if (title) moves.rename(thread.id, title);
  };
  if (editing) {
    return (
      <div {...heading}>
        <input className="title-input" autoFocus defaultValue={thread.title} aria-label={`Rename “${thread.title}”`}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") { event.preventDefault(); refocus.current = true; finish(event.currentTarget.value); }
            if (event.key === "Escape") { event.preventDefault(); refocus.current = true; finish(null); }
          }}
          onBlur={(event) => finish(event.currentTarget.value)} />
      </div>
    );
  }
  return (
    <div {...heading}>
      <button ref={button} type="button" className="title-button" title="Rename"
        onClick={() => { done.current = false; before.current = thread.title; setEditing(true); }}>{thread.title}</button>
    </div>
  );
}
