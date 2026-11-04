// Kept: the sheet survives a reload in this browser, because the page reloads itself when a new build arrives.
import { useCallback, useState } from "react";

const KEY = "e2a2o-draw-";

export function useKept<T>(name: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(KEY + name);
      return saved === null ? initial : JSON.parse(saved) as T;
    } catch { return initial; }
  });
  const keep = useCallback((next: T | ((old: T) => T)) => setValue(old => {
    const value = typeof next === "function" ? (next as (old: T) => T)(old) : next;
    try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch { /* full or blocked: it still works until a reload */ }
    return value;
  }), [name]);
  return [value, keep] as const;
}
