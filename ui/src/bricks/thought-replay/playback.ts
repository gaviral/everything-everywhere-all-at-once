import { useEffect, useRef, type RefObject } from "react";

const editing = () => document.activeElement?.matches("input,textarea,select,[contenteditable]:not([contenteditable=false])");

/** A single reading clock, cancelled whenever the reader leaves or starts editing. */
export function usePlayback(root: RefObject<HTMLElement | null>, playing: boolean, version: string, delay: number,
  advance: () => void, pause: () => void) {
  const callbacks = useRef({ advance, pause });
  callbacks.current = { advance, pause };
  useEffect(() => {
    if (!playing) return;
    if (document.hidden || editing()) { callbacks.current.pause(); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      if (active && !document.hidden && !editing()) callbacks.current.advance();
      else callbacks.current.pause();
    }, delay);
    const interrupt = () => {
      if (document.hidden || editing()) { active = false; clearTimeout(timer); callbacks.current.pause(); }
    };
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) { active = false; clearTimeout(timer); callbacks.current.pause(); }
    });
    if (root.current) observer.observe(root.current);
    document.addEventListener("visibilitychange", interrupt);
    document.addEventListener("focusin", interrupt);
    return () => {
      active = false; clearTimeout(timer); observer.disconnect();
      document.removeEventListener("visibilitychange", interrupt);
      document.removeEventListener("focusin", interrupt);
    };
  }, [playing, version, delay, root]);
}
