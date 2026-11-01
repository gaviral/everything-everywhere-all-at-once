import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";

/* One rule for every picture slot: map cards, branches, folded threads, the unfinished card and Palace tiles.
 * - The thread's letter tile, in its room's color, shows while the picture is queued, being drawn or loading.
 * - The picture fades in only once it has decoded, so a half-loaded or broken image is never on screen.
 * - A picture that fails to load keeps the tile (no broken-image glyph) and is fetched again a few times.
 * Fetching again re-reads a file the core already wrote: it never asks for a new drawing, so it costs nothing.
 * Drawings are capped in the core (core/src/pictures.rs, TRIES). */

/** Waits before each new fetch of a picture that failed with the core still connected. A core that went away
 *  (User's stopped at 09:09 the morning he saw a broken picture) is covered by fetching again when it is back; these
 *  cover a passing failure the connection doesn't show (a busy core, a guest's Wi-Fi): about 40 s in all, then the
 *  tile stays until the core comes back or the page is reloaded. */
export const RETRY_MS = [2_000, 8_000, 30_000] as const;

export type Slot = {
  /** The copies to try, best first (the Palace's large copy, then the map's). */
  sources: string[];
  /** The copy being tried. */
  index: number;
  /** Timed fetches used, at most RETRY_MS.length. */
  timed: number;
  /** Every new fetch counts up, so the browser asks the core again instead of reusing the failure. */
  fetch: number;
  state: "loading" | "shown" | "waiting" | "gave-up";
};

export function start(sources: string[]): Slot {
  return { sources, index: 0, timed: 0, fetch: 0, state: sources.length ? "loading" : "gave-up" };
}

/** The address of the copy being tried; a fetch after a failure carries a count the core ignores. */
export function source(slot: Slot): string | null {
  const src = slot.sources[slot.index];
  if (!src || slot.state === "waiting" || slot.state === "gave-up") return null;
  return slot.fetch ? `${src}?fetch=${slot.fetch}` : src;
}

export function decoded(slot: Slot): Slot {
  return slot.state === "loading" ? { ...slot, state: "shown" } : slot;
}

/** A copy failed: the next copy at once, else a wait before the next fetch, else the tile stays. */
export function failed(slot: Slot): Slot {
  if (slot.state !== "loading") return slot;
  if (slot.index + 1 < slot.sources.length) return { ...slot, index: slot.index + 1 };
  return { ...slot, state: slot.timed < RETRY_MS.length ? "waiting" : "gave-up" };
}

/** How long a waiting slot waits, or null when it isn't waiting. */
export function wait(slot: Slot): number | null {
  return slot.state === "waiting" ? RETRY_MS[slot.timed] : null;
}

/** The wait is over: every copy again, from the best. */
export function retried(slot: Slot): Slot {
  if (slot.state !== "waiting") return slot;
  return { ...slot, index: 0, timed: slot.timed + 1, fetch: slot.fetch + 1, state: "loading" };
}

/** The core is back after a disconnect: a slot that failed tries once more, without using a timed fetch. */
export function back(slot: Slot): Slot {
  if (slot.state !== "waiting" && slot.state !== "gave-up") return slot;
  if (!slot.sources.length) return slot;
  return { ...slot, index: 0, fetch: slot.fetch + 1, state: "loading" };
}

const backListeners = new Set<() => void>();

/** Called by the connection when the core answers again after a disconnect. */
export function coreBack() {
  for (const listener of backListeners) listener();
}

/** A picture slot's state and the props of its <img>; `shown` is true once the picture has decoded. The image
 *  is never visible before that (`is-shown` fades it in); one already decoded when it mounts (a card back from
 *  the Palace) shows at once, with no second fade (`data-instant`). Give the <img> `key={img.src}`, so each fetch is a
 *  new element. */
export function usePicture(sources: string[]) {
  const key = sources.join("\n");
  const [state, setState] = useState(() => ({ key, slot: start(sources), instant: false }));
  // A new picture (or none) starts over, in this same render.
  const current = state.key === key ? state : { key, slot: start(sources), instant: false };
  if (current !== state) setState(current);
  const { slot, instant } = current;
  const src = source(slot);
  const img = useRef<HTMLImageElement | null>(null);

  // Every answer names the address it is about, so one for a copy no longer tried (or an older fetch) changes nothing.
  const update = useCallback((about: string | null, change: (slot: Slot) => Slot, instant = false) => {
    setState((was) => (was.key === key && (about === null || source(was.slot) === about)
      ? { ...was, slot: change(was.slot), instant: was.instant || instant } : was));
  }, [key]);

  // Already in the browser's memory: no fade, it was on screen a moment ago.
  useLayoutEffect(() => {
    const el = img.current;
    if (src && el?.complete && el.naturalWidth > 0) update(src, decoded, true);
  }, [src, update]);

  useEffect(() => {
    const ms = wait(slot);
    if (ms === null) return;
    const timer = setTimeout(() => update(null, retried), ms);
    return () => clearTimeout(timer);
  }, [slot, update]);

  useEffect(() => {
    const listener = () => update(null, back);
    backListeners.add(listener);
    return () => { backListeners.delete(listener); };
  }, [update]);

  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const el = event.currentTarget;
    const loaded = el.getAttribute("src");
    // Shown only once decoded, so the fade starts from a whole picture.
    if (typeof el.decode !== "function") return update(loaded, decoded);
    el.decode().then(() => update(loaded, decoded), () => update(loaded, el.naturalWidth > 0 ? decoded : failed));
  }, [update]);

  const onError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    update(event.currentTarget.getAttribute("src"), failed);
  }, [update]);

  const shown = slot.state === "shown";
  return {
    shown,
    img: src
      ? { ref: img, src, alt: "", onLoad, onError, decoding: "async" as const, "data-instant": instant ? "" : undefined,
          className: shown ? "slot-picture is-shown" : "slot-picture" }
      : null,
  };
}
