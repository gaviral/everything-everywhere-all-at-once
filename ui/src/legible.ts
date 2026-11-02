import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** The app's natural pause: the quiet after which the unfinished card rises (unfinished.ts). The map stays
 *  in its talking state until the same length of quiet has passed, counted from your last landing as well as your
 *  last words, so for a moment after the card rises the map still holds the active and left-off threads forward. */
export const NATURAL_PAUSE_MS = 2500;

/** Whether the person is mid-talk, for how much the map shows at once (legible.css, `.map.talking`).
 *  Talking: your words are being heard or one of your thoughts is on its way, and then until a natural pause has
 *  passed with neither. The pause counts from your last landing too: in a ramble paced like the demo's (a line every
 *  ≈ 6 s, each landing 2–4 s after its words) the next words start within it, so the map stays quiet through the
 *  ramble instead of opening up and going quiet again at every landing, and opens up once you stop. */
export function useTalking({ heard, inFlight }: { heard: string; inFlight: number }) {
  const [talking, setTalking] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (heard || inFlight) { setTalking(true); return; }
    // Nothing heard or on its way: still talking for one natural pause after the last of it (a landing ends a
    // thought's way, so it restarts the pause), then not. On load, with nothing yet, this ends nothing.
    timer.current = window.setTimeout(() => setTalking(false), NATURAL_PAUSE_MS);
  }, [heard, inFlight]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return talking;
}

/** Whether a point's original words say more than the point: the words, not their case or punctuation. A point is
 *  a short version of what was said, and the words behind it open in place (App.tsx Point, by click, tap or Enter). */
export function saidDiffers(text: string, point: string) {
  // An apostrophe joins its word ("Mom's" and "Moms" say the same); any other mark separates words.
  const words = (s: string) => s.toLocaleLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return !!text.trim() && words(text) !== words(point);
}

/** Two map columns fit from this width (legible.css has the arithmetic, and the same number). */
export const TWO_COLUMNS = "(min-width: 1100px)";

/** Whether the window holds two map columns, following resizes. Crossing the width rebuilds every card (they move
 *  into or out of their column), which would drop keyboard focus to the page and send j/k back to the first thread:
 *  the control that had focus gets it back on its new card. */
export function useTwoColumns() {
  const query = typeof window === "undefined" ? null : window.matchMedia(TWO_COLUMNS);
  const [two, setTwo] = useState(() => !!query?.matches);
  const spot = useRef<FocusSpot | null>(null);
  useEffect(() => {
    if (!query) return;
    const change = () => { spot.current = focusSpot(); setTwo(query.matches); };
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    const was = spot.current;
    spot.current = null;
    if (was) restoreFocus(was);
  }, [two]);
  return two;
}

/** Where focus is, in terms that survive a card being rebuilt: the nearest element with an id (a point, a card) and
 *  the control's place among what can take focus inside it. */
export type FocusSpot = { element: HTMLElement; id: string; index: number };
const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])";

export function focusSpot(doc: Document = document): FocusSpot | null {
  const element = doc.activeElement as HTMLElement | null;
  const holder = element && element !== doc.body ? element.closest<HTMLElement>("[id]") : null;
  if (!element || !holder) return null;
  return { element, id: holder.id, index: Array.from(holder.querySelectorAll(FOCUSABLE)).indexOf(element) };
}

/** Puts focus back where `spot` was, if a rebuild took it away (the element left the page); the holder itself when the
 *  control is gone. Focusing scrolls it into view if the new layout moved it off screen. */
export function restoreFocus(spot: FocusSpot, doc: Document = document) {
  if (spot.element.isConnected) return;
  const holder = doc.getElementById(spot.id);
  if (!holder) return;
  const target = spot.index < 0 ? holder : holder.querySelectorAll<HTMLElement>(FOCUSABLE)[spot.index] ?? holder;
  target.focus();
}

/** What a click on a point leaves to its own controls instead of opening its words: its buttons (undo a fix, did you
 *  mean, Words said), its Move menu with the field you type in, and its marks (a tap on ✦ or ? shows that mark's tip). */
export const POINT_OWN = "button, input, textarea, select, .move-menu, [data-tip]";

/** Which points have their original words open, kept outside the cards: crossing the two-column width rebuilds every
 *  card, and folding a thread unmounts its points, and neither should close words the person opened. */
const saidOpen = new Set<string>();
export function useSaidOpen(id: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => saidOpen.has(id));
  const toggle = () => setOpen((was) => { if (was) saidOpen.delete(id); else saidOpen.add(id); return !was; });
  return [open, toggle];
}

/** Root threads in two columns, by their place in the map's order: first left, second right, and so on. Each column
 *  stacks on its own, so a tall card leaves no hole beside it, and a thread's column never changes as cards open,
 *  close or land (only a thread leaving the top level, or a search, reorders them). */
export function intoColumns<T>(roots: T[]): [T[], T[]] {
  return [roots.filter((_, i) => i % 2 === 0), roots.filter((_, i) => i % 2 === 1)];
}
