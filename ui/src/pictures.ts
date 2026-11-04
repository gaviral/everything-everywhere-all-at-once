import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";

/* One rule for every picture slot: map cards, branches, folded threads, the unfinished card and Palace tiles.
 * - The thread's letter tile, in its room's color, shows while the picture is queued, being drawn or loading.
 * - The picture fades in only once it has decoded, so a half-loaded or broken image is never on screen.
 * - A picture that fails to load keeps the tile (no broken-image glyph) and is fetched again a few times.
 * Fetching again re-reads a file the core already wrote: it never asks for a new drawing, so it costs nothing.
 * Drawings are capped in the core (core/src/pictures.rs, TRIES). */

/** Waits before each new fetch of a picture that failed with the core still connected. A core that went away
 *  (a stopped core is how a broken picture was first seen) is covered by fetching again when it is back; these
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

/** A copy named twice (a map that kept only its full picture, which has no Palace copy) is tried once: trying the
 *  same address again would make no new request, so no answer would ever come and the slot would wait forever. */
export function start(sources: string[]): Slot {
  const unique = [...new Set(sources)];
  return { sources: unique, index: 0, timed: 0, fetch: 0, state: unique.length ? "loading" : "gave-up" };
}

/** Where a picture last showed from: which copy, and which fetch of it. */
export type Shown = { index: number; fetch: number };

/** A slot that mounts again starts from the address its picture last showed from, which the browser still holds,
 *  instead of a copy that failed before (that one would load afresh and fade in a second time). */
export function resume(sources: string[], shown?: Shown): Slot {
  const slot = start(sources);
  return shown && shown.index < slot.sources.length ? { ...slot, index: shown.index, fetch: shown.fetch } : slot;
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

/** Each picture's last shown address, by its copies (the key usePicture uses), for slots that mount again. A map holds
 *  tens to a few hundred pictures; the oldest are forgotten past SHOWN_MAX, which only costs a fade. */
const shownFrom = new Map<string, Shown & { src: string }>();
const SHOWN_MAX = 2_000;

function remember(key: string, slot: Slot) {
  const src = source(slot);
  if (slot.state !== "shown" || !src) return;
  shownFrom.delete(key);
  shownFrom.set(key, { index: slot.index, fetch: slot.fetch, src });
  if (shownFrom.size > SHOWN_MAX) shownFrom.delete(shownFrom.keys().next().value!);
}

// The core writes the large copy beside the small one. Older pictures have just one copy.
export const palaceCopy = (picture: string) => picture.replace(/-small\.webp$/, "-palace.webp");

const WARM_MAX = 6;
const WARM_BYTES = 16 * 1024 * 1024;
const warmImages = new Map<string, { image: HTMLImageElement; bytes: number }>();

function forgetWarm(src: string) {
  warmImages.delete(src);
  // Only the un-retried single-source entry belongs to the warmer.
  if (shownFrom.get(src)?.src === src) shownFrom.delete(src);
}

function warmStart(sources: string[]) {
  const warmed = sources.findIndex((src) => warmImages.has(picturePath(src) ?? src));
  const slot = resume(sources, warmed >= 0 ? { index: warmed, fetch: 0 } : shownFrom.get(sources.join("\n")));
  const src = source(slot);
  const warmKey = src && (picturePath(src) ?? src);
  const kept = warmKey && warmImages.get(warmKey);
  if (!kept) return { slot, instant: false };
  warmImages.delete(warmKey!);
  warmImages.set(warmKey!, kept); // a visible use is an LRU touch too
  return { slot: decoded(slot), instant: true };
}

type PictureTopic = { id: string; picture: string | null };

/** Active first, then the two closest topics by map index; ties go to the earlier topic.
 * Only existing same-origin image paths are eligible, never a provider or arbitrary endpoint. */
export function readyPictureSources(threads: readonly PictureTopic[], active: string | null) {
  const index = threads.findIndex((thread) => thread.id === active);
  if (index < 0) return [];
  const nearby = threads.map((thread, at) => ({ thread, at }))
    .sort((a, b) => Math.abs(a.at - index) - Math.abs(b.at - index) || a.at - b.at).slice(0, 3);
  return [...new Set(nearby.flatMap(({ thread }) => thread.picture ? [thread.picture, palaceCopy(thread.picture)] : [])
    .map(picturePath).filter((src): src is string => src !== null))];
}

function picturePath(src: string): string | null {
  try {
    const url = new URL(src, location.href);
    return url.origin === location.origin && url.pathname.startsWith("/images/") && !url.search && !url.hash
      && !url.username && !url.password ? url.pathname : null;
  } catch { return null; }
}

type DataConnection = EventTarget & { saveData?: boolean };

/** This hook owns all warm work. Off means no listeners, timer, requests or retained images.
 * Image.decode uses the same URL as the visible slot, so Chrome can reuse its decoded source at first paint.
 * Each idle pass attempts a URL once; failed URLs wait for visible-slot retries or a new enabled visit. */
export function useReadyPictures(enabled: boolean, threads: readonly PictureTopic[], active: string | null, partial: string, connected: boolean) {
  const plan = JSON.stringify(enabled ? readyPictureSources(threads, active) : []);
  const latest = useRef({ plan, partial, connected });
  latest.current = { plan, partial, connected };
  const refresh = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { refresh.current?.(); }, [plan, active, partial, connected]);
  useEffect(() => {
    if (!enabled) return;
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection;
    const tried = new Set<string>();
    const failures = new Set<string>();
    const running = new Map<string, () => void>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let idle = false;
    let epoch = 0;
    const allowed = () => !disposed && document.visibilityState === "visible" && latest.current.connected
      && !latest.current.partial && !connection?.saveData;
    const sources = (): string[] => JSON.parse(latest.current.plan);
    const pump = () => {
      if (!idle || !allowed()) return;
      for (const src of sources()) {
        if (running.size >= 2) break;
        if (running.has(src) || tried.has(src) || warmImages.has(src)) continue;
        tried.add(src);
        const generation = epoch;
        const image = new Image();
        image.decoding = "async";
        image.fetchPriority = "low";
        let cancelled = false;
        const cancel = () => { cancelled = true; image.removeAttribute("src"); };
        running.set(src, cancel);
        image.src = src;
        image.decode().then(() => {
          if (cancelled || generation !== epoch || !allowed() || !sources().includes(src)) return;
          const bytes = image.naturalWidth * image.naturalHeight * 4;
          if (!bytes || bytes > WARM_BYTES) return;
          let total = [...warmImages.values()].reduce((sum, entry) => sum + entry.bytes, 0);
          while (warmImages.size >= WARM_MAX || total + bytes > WARM_BYTES) {
            const oldest = warmImages.keys().next().value!;
            total -= warmImages.get(oldest)!.bytes;
            forgetWarm(oldest);
          }
          warmImages.set(src, { image, bytes });
          remember(src, decoded(start([src])));
        }, () => {
          if (!cancelled) failures.add(src); // only visible slots retry failed URLs
        })
          .finally(() => {
            // A cancelled decode can settle after a new job for this URL has started.
            if (running.get(src) === cancel) { running.delete(src); pump(); }
          });
      }
    };
    const reset = () => {
      clearTimeout(timer);
      idle = false;
      epoch++;
      tried.clear();
      for (const src of failures) tried.add(src);
      for (const cancel of running.values()) cancel();
      running.clear();
      // Replaced pictures may finish after a map change: neither their reference nor bookkeeping survives.
      const current = new Set(sources());
      for (const src of warmImages.keys()) if (!current.has(src)) forgetWarm(src);
      if (allowed() && current.size) timer = setTimeout(() => { idle = true; pump(); }, 1_000);
    };
    refresh.current = reset;
    document.addEventListener("visibilitychange", reset);
    connection?.addEventListener("change", reset);
    reset();
    return () => {
      disposed = true;
      refresh.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", reset);
      connection?.removeEventListener("change", reset);
      for (const cancel of running.values()) cancel();
      running.clear();
      for (const src of warmImages.keys()) forgetWarm(src);
    };
  }, [enabled]);
}

const backListeners = new Set<() => void>();

/** Called by the connection when the core answers again after a disconnect. */
export function coreBack() {
  for (const listener of backListeners) listener();
}

/** A picture slot's state and the props of its <img>; `shown` is true once the picture has decoded. The image
 *  is never visible before that (`is-shown` fades it in); one this page already showed, still in the browser's memory
 *  when it mounts again (a card back from the Palace), shows at once with no second fade (`data-instant`), decoded
 *  before it is painted (`decoding="sync"`). Give the <img> `key={img.src}`, so each fetch is a new element. */
export function usePicture(sources: string[]) {
  const key = sources.join("\n");
  const [state, setState] = useState(() => ({ key, ...warmStart(sources) }));
  // A new picture (or none) starts over, in this same render.
  const current = state.key === key ? state : { key, ...warmStart(sources) };
  if (current !== state) setState(current);
  const { slot, instant } = current;
  const src = source(slot);
  const img = useRef<HTMLImageElement | null>(null);

  // Every answer names the address it is about, so one for a copy no longer tried (or an older fetch) changes nothing.
  const update = useCallback((about: string | null, change: (slot: Slot) => Slot, instant = false) => {
    setState((was) => (was.key === key && (about === null || source(was.slot) === about)
      ? { ...was, slot: change(was.slot), instant: was.instant || instant } : was));
  }, [key]);

  // Shown before from this very address and still in the browser's memory: no fade, it was on screen a moment ago.
  // Anything else waits for onLoad, which fires for a cached image too, and its decode.
  useLayoutEffect(() => {
    const el = img.current;
    if (src && shownFrom.get(key)?.src === src && el?.complete && el.naturalWidth > 0) update(src, decoded, true);
  }, [key, src, update]);

  useEffect(() => remember(key, slot), [key, slot]);

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
      ? { ref: img, src, alt: "", onLoad, onError, decoding: instant ? "sync" as const : "async" as const, "data-instant": instant ? "" : undefined,
          className: shown ? "slot-picture is-shown" : "slot-picture" }
      : null,
  };
}
