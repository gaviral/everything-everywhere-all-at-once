import { useEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickOn } from "../contract";
import { INTRO_PART_MS, playMotionPart } from "./motion-part";
import { reducedMotionPart, rememberIntroPart, shouldShowIntroPart } from "./session-part";

/** The interruption part observes input without consuming it or moving focus. */
function watchInterruptionPart(finishPart: () => void): () => void {
  const motionPart = reducedMotionPart();
  const eventsPart = ["keydown", "pointerdown", "beforeinput"] as const;
  eventsPart.forEach(part => window.addEventListener(part, finishPart, { capture: true, passive: true }));
  motionPart.addEventListener("change", finishPart);
  window.addEventListener("resize", finishPart);
  document.addEventListener("visibilitychange", finishPart);
  return () => {
    eventsPart.forEach(part => window.removeEventListener(part, finishPart, true));
    motionPart.removeEventListener("change", finishPart);
    window.removeEventListener("resize", finishPart);
    document.removeEventListener("visibilitychange", finishPart);
  };
}

function startIntroPart(rootPart: HTMLElement, finishPart: () => void): () => void {
  rememberIntroPart();
  const stopWatchingPart = watchInterruptionPart(finishPart);
  const stopMotionPart = playMotionPart(rootPart, finishPart);
  // The deadline part clears a suspended or unavailable animation too.
  const deadlinePart = window.setTimeout(finishPart, INTRO_PART_MS + 150);
  return () => { stopWatchingPart(); stopMotionPart(); window.clearTimeout(deadlinePart); };
}

/** The lifecycle part handles one session; the app and capture parts keep running underneath. */
export function useIntroPart(onPart: BrickOn) {
  const [showPart, setShowPart] = useState(shouldShowIntroPart);
  const rootPart = useRef<HTMLDivElement>(null);
  const finishPart = () => setShowPart(false);
  useBrickEvent(onPart, "words", part => { if (part) finishPart(); });
  useEffect(() => {
    if (!showPart || !rootPart.current) return;
    return startIntroPart(rootPart.current, finishPart);
  }, [showPart]);
  return { showPart, rootPart };
}
