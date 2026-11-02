// Undo of a view or a fold asked by voice ("Palace", "expand the garden", then "scratch that" or Undo): the core can't
// know what this window showed before (Map asked on Map, a thread already open, branches open and shut by hand), so
// the window keeps that at each such ask and puts it back when the core says "revert" (core/src/catalog.rs). One step
// is enough: the core only ever undoes the speaker's latest request.
import { useEffect, useRef } from "react";

/** What a voice view or fold changes in the window. */
export type Shown = { view: "map" | "palace"; focusMode: boolean; query: string; expanded: Record<string, boolean>; kept: string[] };

/** One kept state: `keep` replaces it, `take` hands it over once. */
export function reverter<T>() {
  let kept: T | null = null;
  return {
    keep: (shown: T) => { kept = shown; },
    take: (): T | null => { const shown = kept; kept = null; return shown; },
  };
}

/** Returns `keep`, to call just before a voice view or fold is applied; each move of `revert` (a counter the core's
 *  "revert" bumps) puts the kept state back, once. */
export function useRevert(revert: number, now: () => Shown, restore: (shown: Shown) => void): () => void {
  const state = useRef(reverter<Shown>());
  const read = useRef(now);
  read.current = now;
  const put = useRef(restore);
  put.current = restore;
  // A revert and the redone ask can land in one render ("No, I meant expand the bills"): this render's state is still
  // from before the revert, so the ask keeps what the revert put back instead. Cleared first in every render's effects.
  const restored = useRef<Shown | null>(null);
  useEffect(() => { restored.current = null; });
  useEffect(() => {
    if (!revert) return;
    const shown = state.current.take();
    if (shown) put.current(shown);
    restored.current = shown;
  }, [revert]);
  return () => state.current.keep(restored.current ?? read.current());
}
