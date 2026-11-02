// The shelf: things kept at hand while the canvas moves under them. It stays on the screen, bottom right above the
// dock, not on the canvas. Only a hand puts things there (dragging one onto it, or its ⤓); dragging one off places it
// on the canvas where it's dropped, and ↩ puts it back where the layout keeps it. Empty, it's a small tab.
import { forwardRef, useEffect, useRef, useState } from "react";
import type { Shelved } from "./layout";
import { roomStyle } from "./nodes";

const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");
/** How far a press moves before it's a drag, not a click: the canvas's own threshold (index.tsx DRAG). */
const DRAG = 4;

interface Props {
  entries: Shelved[];
  /** Something on the canvas is being dragged: the shelf shows it can take it. */
  carrying: boolean;
  /** …and it's over the shelf now: let go and it's kept. */
  hot: boolean;
  putBack(id: string): void;
  /** Dropped off the shelf at (x, y) on the screen. */
  place(id: string, x: number, y: number): void;
}

export const Shelf = forwardRef<HTMLDivElement, Props>(function Shelf({ entries, carrying, hot, putBack, place }, ref) {
  const [folded, setFolded] = useState(false);
  const [lifted, setLifted] = useState<{ entry: Shelved; x: number; y: number; moved: boolean } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const self = useRef<HTMLDivElement | null>(null);

  // Lifting one off: it follows the pointer; let go off the shelf, it's placed there.
  const liftedNow = useRef(lifted);
  liftedNow.current = lifted;
  useEffect(() => {
    if (!lifted) return;
    const move = (event: PointerEvent) => setLifted((was) => was && {
      ...was, x: event.clientX, y: event.clientY, moved: was.moved || Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > DRAG,
    });
    const up = (event: PointerEvent) => {
      const was = liftedNow.current;
      setLifted(null);
      if (!was?.moved) return;
      const box = self.current?.getBoundingClientRect();
      const onShelf = box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!onShelf) place(was.entry.id, event.clientX, event.clientY);
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setLifted(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", cancel);
    };
  }, [!!lifted, place]);

  const setRef = (element: HTMLDivElement | null) => {
    self.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };
  const empty = !entries.length;
  return <>
    <div ref={setRef} className={cls("spine-shelf", empty && "spine-shelf-empty", carrying && "spine-shelf-ready", hot && "spine-shelf-hot")}
      role="region" aria-label="Shelf: things kept at hand">
      {empty || carrying ? <p className="spine-shelf-tab" title="Drag anything here to keep it at hand">
        <span aria-hidden="true">⤓</span> {carrying ? (hot ? "Let go to keep it here" : "Drop here to keep it at hand") : "Shelf"}
      </p> : <>
        <button type="button" className="spine-shelf-head" aria-expanded={!folded} onClick={() => setFolded((was) => !was)}>
          <span>Shelf · {entries.length}</span><span aria-hidden="true">{folded ? "▴" : "▾"}</span>
        </button>
        {!folded && <ul className="spine-shelf-list">
          {entries.map((entry) => <li key={entry.id} className={cls("spine-shelf-item", lifted?.entry.id === entry.id && lifted.moved && "spine-shelf-lifted")} style={roomStyle(entry.room)}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as Element).closest("button")) return;
              start.current = { x: event.clientX, y: event.clientY };
              setLifted({ entry, x: event.clientX, y: event.clientY, moved: false });
            }}>
            <span className="spine-shelf-dot" aria-hidden="true" />
            <span className={cls("spine-shelf-text", entry.kind === "thread" && "spine-shelf-thread")} title={`${entry.text}. Drag it onto the canvas to place it.`}>{entry.text}</span>
            <button type="button" className="spine-shelf-back" aria-label={`Put “${entry.text}” back in its place`} title="Back to its place" onClick={() => putBack(entry.id)}>↩</button>
          </li>)}
        </ul>}
      </>}
    </div>
    {lifted?.moved && <div className="spine-shelf-ghost" style={{ ...roomStyle(lifted.entry.room), left: lifted.x, top: lifted.y }} aria-hidden="true">
      <span className="spine-shelf-dot" />{lifted.entry.text}
    </div>}
  </>;
});
