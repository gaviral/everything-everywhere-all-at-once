import type { Thread, Thought } from "./core";
import { readingTime } from "./notice-rules";
import { useEffect, useMemo, useState, type SetStateAction } from "react";

// The unfinished card in the dock (App.tsx): at a natural pause, the thread you left last, your last words there, and
// Finish it, Later or Forget it. Checked by scripts/unfinished-check.mjs.

/** A natural pause: this long without new words, live or kept, before the card rises (legible.ts NATURAL_PAUSE_MS). */
export const PAUSE_MS = 2500;
/** The first Later hides the card this long; then it's offered once more. */
export const LATER_MS = 5 * 60 * 1000;

/** Cards you've answered: set aside until their thread changes (`dismissed`), or put off by Later, and when. */
export interface Hidden { dismissed: string[]; laterAt: Record<string, number> }
export const NONE_HIDDEN: Hidden = { dismissed: [], laterAt: {} };

/** Recognize a saved map by any surviving thought, so deleting its first words cannot undo Later. */
export function useHidden(thoughts: Thought[], me: string): [Hidden, (change: SetStateAction<Hidden>) => void] {
  const words = useMemo(() => thoughts.map((t) => `${t.id}:${t.at_ms}`), [thoughts]);
  const key = useMemo(() => {
    const prefix = `e2a2o.unfinished:${location.host}${location.pathname}:`;
    const first = thoughts.reduce<Thought | null>((first, t) => !first || t.at_ms < first.at_ms ? t : first, null);
    const initial = first ? `${prefix}${first.id}:${first.at_ms}:${me}` : null;
    try {
      for (const stored of Object.keys(localStorage)) {
        if (!stored.startsWith(prefix) || !stored.endsWith(`:${me}`)) continue;
        const saved = JSON.parse(localStorage.getItem(stored) ?? "null");
        if (Array.isArray(saved?.words) && saved.words.some((word: unknown) => typeof word === "string" && words.includes(word))) return stored;
      }
    } catch { /* Storage unavailable: keep choices for this visit. */ }
    return initial;
  }, [thoughts, words, me]);
  const read = (): Hidden => {
    try {
      const saved = JSON.parse(key ? localStorage.getItem(key) ?? "null" : "null");
      if (Array.isArray(saved?.dismissed) && saved.dismissed.every((k: unknown) => typeof k === "string")
        && saved.laterAt && typeof saved.laterAt === "object" && !Array.isArray(saved.laterAt)
        && Object.values(saved.laterAt).every((at) => typeof at === "number" && Number.isFinite(at))) return saved;
    } catch { /* No saved choices, or storage unavailable. */ }
    return NONE_HIDDEN;
  };
  const [held, setHeld] = useState(() => ({ key, hidden: read() }));
  const hidden = useMemo(() => held.key === key ? held.hidden : read(), [held, key]);
  // Add identities to older saved choices, and remember new words before older ones can be deleted.
  useEffect(() => {
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved) localStorage.setItem(key, JSON.stringify({ ...saved, words: [...new Set([...(saved.words ?? []), ...words])] }));
    } catch { /* Storage unavailable: keep choices for this visit. */ }
  }, [key, words]);
  return [hidden, (change) => {
    setHeld((was) => {
      const next = typeof change === "function" ? change(was.key === key ? was.hidden : hidden) : change;
      try { if (key) localStorage.setItem(key, JSON.stringify({ ...next, words })); } catch { /* Keep the choice for this visit. */ }
      return { key, hidden: next };
    });
  }];
}

/** A thread as you left it: new words there make it a new one to offer. */
export const dropKey = (t: Thread) => `${t.id}:${t.touched_ms}`;

/** What the card offers, or would at the next pause: the newest thread you left that isn't hidden. Only yours: in a
 *  room, the other person's are theirs to pick up. */
export function leftOff(threads: Thread[], me: string, hidden: Hidden, now: number): Thread | undefined {
  return threads
    .filter((t) => t.status === "dropped" && t.dropped_by === me && !hidden.dismissed.includes(dropKey(t)) &&
      (hidden.laterAt[dropKey(t)] === undefined || now - hidden.laterAt[dropKey(t)] >= LATER_MS))
    .sort((a, b) => b.touched_ms - a.touched_ms)[0];
}

/** Offer a new card only after PAUSE_MS without new words. An already shown card keeps its reading time. */
export const cardAt = (offered: Thread | undefined, now: number, lastWordsAt: number) =>
  offered && now - lastWordsAt > PAUSE_MS ? offered : null;

/** Read the whole card at 200 words/minute, with time to notice it, decide and reach a button. */
export const lingerMs = (title: string, quote: string) =>
  readingTime(`You didn't finish ${title} ${quote} Finish it Later Forget it`);

/** Later: hidden for LATER_MS, then offered once more; a second Later sets it aside until that thread changes. */
export function putOff(hidden: Hidden, thread: Thread, now: number): Hidden {
  const key = dropKey(thread);
  if (hidden.laterAt[key] !== undefined) return dismiss(hidden, [key]);
  return { ...hidden, laterAt: { ...hidden.laterAt, [key]: now } };
}

/** Sets cards aside until their thread changes; the same value when they already are. */
export function dismiss(hidden: Hidden, keys: string[]): Hidden {
  if (keys.every((key) => hidden.dismissed.includes(key))) return hidden;
  return { ...hidden, dismissed: [...new Set([...hidden.dismissed, ...keys])] };
}

/** The words the card quotes: your last there, by when you said them, as the core's Thought::said_at: imported points
 *  land last in the list with their old times, and a time ahead of the clock (a sample map) counts as the earliest. */
export function lastWords(thoughts: Thought[], thread: Thread, me: string, now: number): string {
  const saidAt = (t: Thought) => (t.at_ms > now ? 0 : t.at_ms);
  return thoughts.filter((t) => t.placed && t.thread_id === thread.id && t.speaker === me)
    .reduce<Thought | undefined>((last, t) => (!last || saidAt(t) >= saidAt(last) ? t : last), undefined)?.text ?? "";
}
