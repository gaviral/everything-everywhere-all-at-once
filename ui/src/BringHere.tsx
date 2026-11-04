import { useEffect } from "react";
import type { World } from "./core";
import { NAMES } from "./shell/names";
import "./bring-here.css";

/** A temporary view, never a new thought, position, selection or navigation request. */
export function BringHere({ id, world, close, openOriginal }: {
  id: string; world: World; close: () => void; openOriginal: () => void;
}) {
  const thread = world.threads.find((thread) => thread.id === id);
  const thoughts = world.thoughts.filter((thought) => thought.thread_id === id)
    .sort((a, b) => a.at_ms - b.at_ms);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [close]);
  // No autofocus: opening with a pointer leaves the input and its cursor where they were.
  return <section className="bring-here" aria-label="Inspect here" onKeyDown={(event) => event.stopPropagation()}>
    <header>
      <span>Inspect here · read only</span>
      <button type="button" className="shell-btn" onPointerDown={(event) => event.preventDefault()} onClick={close} aria-label="Close inspection">{NAMES.close}</button>
    </header>
    <div className="bring-here-content">
      {thread ? <>
        <h2>{thread.title}</h2>
        <p className="bring-here-id">Source ID: <code>{id}</code></p>
        <ol>{thoughts.map((thought) => <li key={thought.id}>
          {thought.point && <p className="bring-here-point">{thought.point}</p>}
          <p className="bring-here-words">{thought.text}</p>
        </li>)}</ol>
        {!thoughts.length && <p>No points yet.</p>}
      </> : <><p role="status">Source no longer on map</p><p className="bring-here-id">Source ID: <code>{id}</code></p></>}
    </div>
    <footer><button type="button" className="shell-btn" disabled={!thread} onPointerDown={(event) => event.preventDefault()} onClick={openOriginal}>{NAMES.openOriginal}</button></footer>
  </section>;
}
