import { useEffect, useRef } from "react";
import type { BrickProps, MapSnapshot } from "../contract";
import "./read-progress.css";

const PREFIX = "e2a2o.brick.read-progress.";
const DWELL_MS = 1500;

/** The part of the window a point can be read in: the header (with the map's tools while they stay pinned) covers its
 *  top and the dock its bottom, so a point under either isn't read. The app publishes their heights on the page. */
function readable() {
  const style = getComputedStyle(document.documentElement);
  const px = (name: string) => Math.round(parseFloat(style.getPropertyValue(name)) || 0);
  const tools = document.querySelector(".map-tools");
  const pinned = tools && getComputedStyle(tools).position === "sticky" ? px("--tools-height") : 0;
  return `-${px("--header-height") + pinned}px 0px -${px("--dock-height")}px 0px`;
}

type Point = {
  element: HTMLLIElement;
  thoughtId: string;
  threadId: string;
  ids: string[];
  rank: number;
  fullyVisible: boolean;
  timer?: number;
  dot?: HTMLSpanElement;
};

/** Only DOM ids and the existing snapshot connect a card to its thoughts. No app imports or new fields. */
function watchPoints(initial: MapSnapshot) {
  let snapshot = initial;
  const points = new Map<HTMLLIElement, Point>();
  const marks = new Map<string, string | null>();
  let ranks = new Map<string, number>();
  const rankOf = (threadId: string, id: string | null) => id === null ? -1 : ranks.get(JSON.stringify([threadId, id])) ?? -1;

  const stored = (threadId: string) => {
    if (!marks.has(threadId)) {
      let id: string | null = null;
      try { id = localStorage.getItem(PREFIX + threadId); } catch { /* Private storage can be unavailable. */ }
      marks.set(threadId, id);
    }
    return marks.get(threadId) ?? null;
  };
  const cancel = (point: Point) => {
    window.clearTimeout(point.timer);
    point.timer = undefined;
  };
  const clean = (point: Point) => {
    cancel(point);
    point.dot?.remove();
    point.element.classList.remove("read-progress-point", "read-progress-mark");
    intersection?.unobserve(point.element);
  };
  const paint = () => {
    for (const point of points.values()) {
      const id = stored(point.threadId);
      const rank = rankOf(point.threadId, id);
      const marked = id !== null && point.ids.includes(id);
      // Do not rewrite unchanged classes: our MutationObserver also sees our own DOM changes.
      if (!point.element.classList.contains("read-progress-point")) point.element.classList.add("read-progress-point");
      if (point.element.classList.contains("read-progress-mark") !== marked) point.element.classList.toggle("read-progress-mark", marked);
      if (!marked && point.rank > rank) {
        if (!point.dot) {
          point.dot = document.createElement("span");
          point.dot.className = "read-progress-dot";
          point.dot.setAttribute("aria-hidden", "true");
        }
        if (point.dot.parentElement !== point.element) point.element.append(point.dot);
      } else {
        point.dot?.remove();
        point.dot = undefined;
      }
    }
  };
  const mark = (point: Point, automatic: boolean) => {
    if (!point.element.isConnected || document.visibilityState === "hidden") return;
    const previous = stored(point.threadId);
    // Scrolling advances; an explicit tap may deliberately move the bookmark back.
    if (automatic && point.rank <= rankOf(point.threadId, previous)) return;
    if (previous === point.thoughtId) return;
    marks.set(point.threadId, point.thoughtId);
    try { localStorage.setItem(PREFIX + point.threadId, point.thoughtId); } catch { /* Keep working in memory. */ }
    paint();
  };
  const updateVisibility = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      const point = points.get(entry.target as HTMLLIElement);
      if (!point) continue;
      const full = entry.isIntersecting && entry.intersectionRatio >= 1 && document.visibilityState !== "hidden";
      if (!full) cancel(point);
      else if (!point.fullyVisible) {
        const timer = window.setTimeout(() => {
          // Account for visibility changes queued since the last observer callback.
          updateVisibility(intersection?.takeRecords() ?? []);
          if (point.timer !== timer) return;
          point.timer = undefined;
          if (point.fullyVisible) mark(point, true);
        }, DWELL_MS);
        point.timer = timer;
      }
      point.fullyVisible = full;
    }
  };
  let intersection: IntersectionObserver | null = null;
  let margin = "";
  // A new observer when the header or the dock changes height; points that stay in view keep their running dwell.
  const observe = () => {
    const next = readable();
    if (next === margin || typeof IntersectionObserver === "undefined") return;
    margin = next;
    intersection?.disconnect();
    intersection = new IntersectionObserver(updateVisibility, { threshold: [0, 1], rootMargin: margin });
    for (const point of points.values()) intersection.observe(point.element);
  };

  const sync = (next = snapshot) => {
    snapshot = next;
    observe();
    const threads = new Set(snapshot.threads.map((thread) => thread.id));
    // Match the cards' chronological order, including imported thoughts dated ahead of the clock.
    const limit = Date.now() + 60 * 60 * 1000;
    const said = (at: number) => at > limit ? 0 : at;
    const thoughts = snapshot.thoughts.filter((thought) => thought.placed && thought.thread_id && threads.has(thought.thread_id))
      .sort((a, b) => said(a.at_ms) - said(b.at_ms));
    ranks = new Map(thoughts.map((thought, i) => [JSON.stringify([thought.thread_id, thought.id]), i]));
    const others = new Map(thoughts.filter((thought) => thought.speaker !== snapshot.me).map((thought) => [thought.id, thought]));
    const found = new Set<HTMLLIElement>();
    for (const element of document.querySelectorAll<HTMLLIElement>(".points li")) {
      if (!element.id.startsWith("point-")) continue;
      const thought = others.get(element.id.slice("point-".length));
      if (!thought || element.closest(".thread")?.id !== `thread-${thought.thread_id}`) continue;
      found.add(element);
      let point = points.get(element);
      if (point && (point.thoughtId !== thought.id || point.threadId !== thought.thread_id)) {
        clean(point);
        points.delete(element);
        point = undefined;
      }
      if (!point) {
        point = { element, thoughtId: thought.id, threadId: thought.thread_id!, ids: [], rank: 0, fullyVisible: false };
        points.set(element, point);
        intersection?.observe(element);
      }
      // A stored head can later become part of a joined point, whose representative has another id.
      point.ids = [thought.id, ...(element.dataset.heads?.split(" ").filter(Boolean) ?? [])];
      point.rank = rankOf(point.threadId, thought.id);
    }
    for (const [element, point] of points) if (!found.has(element)) { clean(point); points.delete(element); }
    paint();
  };
  // Cards can fold, reopen, or be replaced by another view without a new snapshot.
  const mutations = new MutationObserver(() => sync());
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["id", "class", "data-heads"] });
  // The heights live on the page's root (--dock-height and the rest).
  mutations.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  const click = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target.closest<HTMLLIElement>(".points li") : null;
    const point = element && points.get(element);
    if (!point) return;
    // A tap keeps its chosen place until another point enters view, rather than a pending timer overriding it.
    for (const candidate of points.values()) if (candidate.threadId === point.threadId) cancel(candidate);
    mark(point, false);
  };
  const visibility = () => {
    intersection?.disconnect();
    for (const point of points.values()) {
      cancel(point);
      point.fullyVisible = false;
      if (document.visibilityState !== "hidden") intersection?.observe(point.element);
    }
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(PREFIX)) return;
    marks.clear();
    paint();
  };
  document.addEventListener("click", click, true);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("storage", storage);
  sync();
  return {
    sync,
    stop: () => {
      mutations.disconnect();
      intersection?.disconnect();
      document.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storage);
      for (const point of points.values()) clean(point);
    },
  };
}

export default function ReadProgress({ map }: BrickProps) {
  const watcher = useRef<ReturnType<typeof watchPoints> | null>(null);
  const hasOthers = map.threads.length > 0 && map.thoughts.some((thought) => thought.placed && thought.speaker !== map.me);
  useEffect(() => {
    if (!hasOthers) return;
    watcher.current = watchPoints(map);
    return () => { watcher.current?.stop(); watcher.current = null; };
  }, [hasOthers, map.me]);
  useEffect(() => { watcher.current?.sync(map); }, [map.thoughts, map.threads, map.me]);
  return null;
}
