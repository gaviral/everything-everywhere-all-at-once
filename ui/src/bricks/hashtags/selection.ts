import { useLayoutEffect, useRef, useState, type RefObject } from "react";

// Keep the filter through a source jump and return, including when Plugins is off.
// Only a tag name is stored, scoped to this map visit and participant.
const visitSelections = new Map<string, string | null>();

function readSelection(key: string): string | null {
  if (visitSelections.has(key)) return visitSelections.get(key) ?? null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function useTagSelection(scope: string) {
  const key = `hashtags:selection:${scope}`;
  const [selected, update] = useState(() => readSelection(key));
  function select(tag: string | null) {
    visitSelections.set(key, tag);
    try {
      if (tag === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, tag);
    } catch { /* The current visit's in-memory selection still works. */ }
    update(tag);
  }
  return [selected, select] as const;
}

export function useTagReturnFocus(strip: RefObject<HTMLDivElement | null>, selected: string | null) {
  const returningTo = useRef(selected);
  useLayoutEffect(() => {
    if (returningTo.current) strip.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [strip]);
}
