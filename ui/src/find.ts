import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useReducedMotion } from "motion/react";
import type { World } from "./core";
import { resolveMerged } from "./merges";
import "./find.css";
import { look, wordsIn } from "./Attention";
import type { ViewDestination } from "./bricks/contract";

/** Whether focus is in a field the person types in: a jump shows its point there without taking focus from it. */
export function typingIn(element: Element | null): boolean {
  if (!element) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || (element as HTMLElement).isContentEditable === true;
}

export type Found = { thread_id: string; thought_id: string | null; item_id?: string; revision: number };

/** The view a jump to a thread (Find, a Palace tile, "where was I?", "expand …") ends on: where its card already shows,
 *  the map or the shell's Cards; from any other view, `home`, where the page opens. */
export const viewAfterJump = (was: string, home: string) => (was === "map" || was === "cards" ? was : home);

type Reveal = {
  /** "map", "palace", "cards" (the shell's) or a view brick's id (App.tsx). */
  setView: Dispatch<SetStateAction<string>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setDestination?: Dispatch<SetStateAction<ViewDestination | null>>;
};

// Only a private, live result moves the viewport. Replaying a journal never does.
export function useFindJump(found: Found | null, world: World, { setView, setQuery, setFocusMode, setExpanded, setDestination }: Reveal, home = "map") {
  const [requested, setRequested] = useState<Found | null>(null);
  useEffect(() => setRequested(found), [found]);
  const reveal = useCallback((thread_id: string, thought_id: string | null = null, item_id?: string) => {
    setRequested((previous) => ({ thread_id, thought_id, item_id, revision: (previous?.revision ?? 0) + 1 }));
  }, []);
  const reducedMotion = useReducedMotion();
  const currentWorld = useRef(world);
  currentWorld.current = world;
  useEffect(() => {
    const found = requested;
    if (!found) return;
    const world = currentWorld.current;
    const id = resolveMerged(world, found.thread_id);
    if (!world.threads.some((thread) => thread.id === id)) return;
    setView((was) => viewAfterJump(was, home));
    setDestination?.((was) => ({ threadId: id, thoughtId: found.thought_id, revision: (was?.revision ?? 0) + 1 }));
    setQuery("");
    setFocusMode(false);
    setExpanded((state) => {
      const next = { ...state };
      let thread = world.threads.find((thread) => thread.id === id);
      const seen = new Set<string>();
      while (thread && !seen.has(thread.id)) {
        seen.add(thread.id);
        next[thread.id] = false;
        thread = world.threads.find((parent) => parent.id === thread?.parent_id);
      }
      return next;
    });

    let target: HTMLElement | null = null;
    let frame = 0;
    let unlook = () => {};
    // Let the cleared search, map view and unfolded points render before looking up the point.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        target = (found.item_id ? document.getElementById(`item-${found.item_id}`) : null)
          ?? (found.thought_id ? document.getElementById(`point-${found.thought_id}`) : null)
          // A part said before a pause shows inside the point that carries it on (chunks.tsx).
          ?? (found.thought_id ? document.querySelector<HTMLElement>(`[data-heads~="${CSS.escape(found.thought_id)}"]`) : null)
          ?? document.getElementById(`thread-${id}`);
        if (!target) return;
        // Make the destination available to keyboard and screen-reader users as well as sighted users.
        const hadTabindex = target.hasAttribute("tabindex");
        if (!hadTabindex) target.setAttribute("tabindex", "-1");
        target.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
        // Still typing (the composer, search): focus stays there, or the next Backspace deletes the found point.
        if (!typingIn(document.activeElement)) target.focus({ preventScroll: true });
        if (!hadTabindex) target.addEventListener("blur", () => target?.removeAttribute("tabindex"), { once: true });
        // The one "look here" highlight (Attention.tsx), for as long as reading it takes; a thread's is on its head.
        const title = currentWorld.current.threads.find((thread) => thread.id === id)?.title ?? "";
        unlook = look(target.querySelector<HTMLElement>(":scope > .thread-head") ?? target, target.id.startsWith("thread-") ? title : `${title} ${wordsIn(target)}`);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unlook();
    };
  }, [requested, reducedMotion, setView, setQuery, setFocusMode, setExpanded, setDestination, home]);
  return reveal;
}
