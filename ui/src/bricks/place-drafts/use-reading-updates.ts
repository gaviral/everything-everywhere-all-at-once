import { useEffect, useRef, useState, type RefObject } from "react";
import type { ReadingDocument } from "./documents";

/** New snapshots wait for focus, a drag and a source selection to finish. No idle timer guesses. */
export function useReadingUpdates(incoming: ReadingDocument[], root: RefObject<HTMLElement | null>) {
  const [shown, setShown] = useState(incoming);
  const latest = useRef(incoming);
  latest.current = incoming;
  const held = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let down = false;
    const settle = () => {
      const element = root.current;
      const selection = window.getSelection();
      held.current = !!element && (down || element.contains(document.activeElement)
        || (!!selection && !selection.isCollapsed && element.contains(selection.anchorNode)));
      if (!held.current) { setShown(latest.current); setPending(false); }
    };
    const pointerDown = (event: PointerEvent) => { down = !!root.current?.contains(event.target as Node); settle(); };
    const pointerUp = () => { down = false; settle(); };
    // focusout fires before the new activeElement is installed.
    const focus = () => queueMicrotask(settle);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerup", pointerUp, true);
    document.addEventListener("pointercancel", pointerUp, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    document.addEventListener("selectionchange", settle);
    window.addEventListener("blur", pointerUp);
    settle();
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointerup", pointerUp, true);
      document.removeEventListener("pointercancel", pointerUp, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
      document.removeEventListener("selectionchange", settle);
      window.removeEventListener("blur", pointerUp);
    };
  }, [root]);
  useEffect(() => {
    if (held.current) setPending(incoming !== shown);
    else { setShown(incoming); setPending(false); }
  }, [incoming, shown]);
  const release = () => {
    window.getSelection()?.removeAllRanges();
    if (root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    held.current = false;
    setShown(latest.current);
    setPending(false);
  };
  return { documents: shown, pending, release };
}
