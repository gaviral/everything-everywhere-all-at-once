import { useEffect, useLayoutEffect, useRef } from "react";
import { useBrickEvent, type BrickOn } from "../contract";

export function useNavigation(on: BrickOn, enabled: boolean, move: (step: number) => void) {
  const utterance = useRef("");
  useBrickEvent(on, "words", words => {
    const command = words.trim().toLowerCase().replace(/[.!?]+$/, "");
    if (!command) { utterance.current = ""; return; }
    if (command === utterance.current) return;
    utterance.current = command;
    if (enabled && (command === "next" || command === "back")) move(command === "next" ? 1 : -1);
  });
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat ||
        (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); event.stopImmediatePropagation(); move(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [enabled, move]);
}

export function useCardFocus(enabled: boolean, position: string) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const card = document.querySelector<HTMLElement>('.showroom-card[aria-current="true"]');
    const button = card?.querySelector<HTMLButtonElement>(".showroom-try:not(:disabled)");
    button?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [enabled, position]);
}
