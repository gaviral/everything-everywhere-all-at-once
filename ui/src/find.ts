import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useReducedMotion } from "motion/react";
import type { World } from "./core";
import "./find.css";

export type Found = { thread_id: string; thought_id: string | null; revision: number };

type Reveal = {
  setView: Dispatch<SetStateAction<"map" | "palace">>;
  setQuery: Dispatch<SetStateAction<string>>;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
};

// Only a private, live result moves the viewport. Replaying a journal never does.
export function useFindJump(found: Found | null, world: World, { setView, setQuery, setFocusMode, setExpanded }: Reveal) {
  const reducedMotion = useReducedMotion();
  const currentWorld = useRef(world);
  currentWorld.current = world;
  useEffect(() => {
    if (!found) return;
    const world = currentWorld.current;
    let id = found.thread_id;
    for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[id]; hops--) id = world.merged[id];
    if (!world.threads.some((thread) => thread.id === id)) return;
    setView("map");
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
    let timer = 0;
    // Let the cleared search, map view and unfolded points render before looking up the point.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        target = (found.thought_id ? document.getElementById(`point-${found.thought_id}`) : null)
          ?? document.getElementById(`thread-${id}`);
        if (!target) return;
        target.dataset.found = "true";
        // Make the destination available to keyboard and screen-reader users as well as sighted users.
        const hadTabindex = target.hasAttribute("tabindex");
        if (!hadTabindex) target.setAttribute("tabindex", "-1");
        target.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
        target.focus({ preventScroll: true });
        if (!hadTabindex) target.addEventListener("blur", () => target?.removeAttribute("tabindex"), { once: true });
        timer = window.setTimeout(() => target?.removeAttribute("data-found"), 4200);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      target?.removeAttribute("data-found");
    };
  }, [found, reducedMotion, setView, setQuery, setFocusMode, setExpanded]);
}
