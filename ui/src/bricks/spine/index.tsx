// The Spine: the map as one canvas you can pan and zoom without end. Each topic is a spine of its points, oldest at
// the top; each tangent hangs beside the point it came from (layout.ts). It follows what you're talking about, and
// lets go the moment you move it. Anything can be dragged where you want it and stays there (map.positions), and the
// shelf keeps things at hand while the canvas moves. A view brick (docs/bricks.md): its name joins Map and Palace.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EdgeLabelRenderer, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useStoreApi, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useBrickEvent, type BrickProps, type Position } from "../contract";
import { bounds, G, layout as place, type Box, type End, type Item, type Layout, type Link } from "./layout";
import { ActsContext, ItemView, NowContext, READ, type Acts, type ItemData, type ItemNode } from "./nodes";
import { Shelf } from "./shelf";
import "./spine.css";

/** A press that moves less than this is a click, not a drag: a hand's wobble on a click is 1–3 px. */
const DRAG = 4;
/** Things making room glide this long (Material's standard duration for elements moving on screen, 300 ms). */
const GLIDE_MS = 300;
/** Reading, as the app's notices count it (notice-rules.ts): 238 words a minute (Brysbaert 2019), a 200 ms look first,
 *  and never under the 5 s every notice gets. */
const READ_WPM = 238;
const LOOK_MS = 200;
const SHORTEST_MS = 5000;
const readMs = (text: string) => LOOK_MS + Math.round((text.trim().split(/\s+/).filter(Boolean).length * 60_000) / READ_WPM);
/** Where the follow keeps your latest point: 55% down the free part of the screen, so what led to it shows above it
 *  and the next point has room below; it only moves once the point leaves the middle (8–92% across, 10–80% down). */
const AIM = 0.55;
const COMFORT = { left: 0.08, right: 0.92, top: 0.1, bottom: 0.8 };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");
const LINK_CLASS: Record<Link["kind"], string> = { spine: "spine-link-spine", branch: "spine-link-branch", pulled: "spine-link-pulled" };

export default function Spine(props: BrickProps) {
  if (!props.map.threads.length) return <p className="spine-empty">Nothing on the map yet. Say or type a thought, and its spine starts here.</p>;
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function useReducedMotion() {
  const query = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");
  const [reduced, setReduced] = useState(!!query?.matches);
  useEffect(() => {
    if (!query) return;
    const changed = () => setReduced(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return reduced;
}

/** Things move to their new places together, over GLIDE_MS, instead of jumping; `held` are where a hand holds them now
 *  (a drag), and the next glide starts from there. */
function useGlide(layout: Layout, reduced: boolean, held: Map<string, { x: number; y: number }> | null) {
  const shown = useRef(new Map<string, { x: number; y: number }>());
  const [, tick] = useState(0);
  if (held) for (const [key, at] of held) shown.current.set(key, at);
  useLayoutEffect(() => {
    const from = new Map(shown.current);
    const to = new Map(layout.items.map((item) => [item.key, { x: item.box.x, y: item.box.y }]));
    const moving = [...to].filter(([key, at]) => {
      const was = from.get(key);
      return was && (Math.abs(was.x - at.x) > 0.5 || Math.abs(was.y - at.y) > 0.5);
    });
    if (reduced || !moving.length) {
      shown.current = to;
      if (moving.length) tick((n) => n + 1);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / GLIDE_MS);
      const e = ease(t);
      const next = new Map(to);
      for (const [key, at] of moving) {
        const was = from.get(key)!;
        next.set(key, { x: was.x + (at.x - was.x) * e, y: was.y + (at.y - was.y) * e });
      }
      shown.current = next;
      tick((n) => n + 1);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [layout, reduced]);
  return shown.current;
}

/** A link's path, from where its two ends are shown. A tangent's curve runs straight along its point's row into the
 *  gutter first, then bends there, so it never crosses a column's words. */
function pathOf(link: Link, at: (end: End) => { x: number; y: number } | null) {
  const a = at(link.from);
  const b = at(link.to);
  if (!a || !b) return null;
  if (link.kind === "spine") return `M${a.x} ${a.y}V${b.y}`;
  let start = `M${a.x} ${a.y}`;
  let x0 = a.x;
  if (link.kind === "branch" && link.lead !== undefined) {
    const lead = at({ ...link.from, dx: link.lead })!.x;
    if ((b.x - a.x) * (lead - a.x) > 0 && Math.abs(lead - a.x) < Math.abs(b.x - a.x)) {
      start += `H${lead}`;
      x0 = lead;
    }
  }
  const mid = (x0 + b.x) / 2;
  return `${start}C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
}

/** This viewer's shelf: what they keep at hand, by id, with when. It's theirs (it floats with them, whoever else is on
 *  the map), so this browser keeps it, per map: the address and when the map's first thought was said. */
function useShelf(map: BrickProps["map"]) {
  const first = map.thoughts.reduce((at, t) => Math.min(at, t.at_ms), Infinity);
  const key = Number.isFinite(first) ? `e2a2o.spine.shelf:${location.host}:${first}` : null;
  const read = (k: string | null): Map<string, number> => {
    if (!k) return new Map();
    try {
      const kept = JSON.parse(localStorage.getItem(k) ?? "[]");
      return new Map(Array.isArray(kept) ? kept.filter((e) => Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1])) : []);
    } catch { return new Map(); }
  };
  const [held, setHeld] = useState(() => ({ key, items: read(key) }));
  const items = held.key === key ? held.items : read(key);
  const write = (next: Map<string, number>) => {
    try { if (key) localStorage.setItem(key, JSON.stringify([...next])); } catch { /* private mode: for this visit */ }
    setHeld({ key, items: next });
  };
  return {
    items,
    add: (id: string) => { const next = new Map(items); next.set(id, Date.now()); write(next); },
    remove: (id: string) => { if (!items.has(id)) return; const next = new Map(items); next.delete(id); write(next); },
  };
}

function Canvas({ map, actions, on }: BrickProps) {
  const flow = useReactFlow<ItemNode>();
  const reduced = useReducedMotion();
  const shelf = useShelf(map);
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(0);
  const [open, setOpen] = useState<{ id: string; by: "follow" | "you" } | null>(null);
  const [following, setFollowing] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Position | null>>({});
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  // While a hand holds something, the map's echoes of its own steps don't move it under the hand: it stays where it was
  // when the drag began (`grip`), and lands where it's dropped.
  const grip = useRef<{ id: string; was: Position | undefined } | null>(null);
  const [overShelf, setOverShelf] = useState(false);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [cues, setCues] = useState<{ key: string; title: string; until: number }[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const touched = useRef(0);

  // The canvas fills the window under what stays pinned at its top (the header and the tools), as wide as the place the
  // page gives a view, and the dock floats over its foot. What scrolls above the view (the Apps panel) pushes it down
  // until the page is scrolled; opening, the page scrolls so the canvas has the whole window.
  const [box, setBox] = useState<{ top: number; left: number; right: number; tall: number } | null>(null);
  const opened = useRef(false);
  useLayoutEffect(() => {
    const measure = () => {
      const here = anchor.current;
      if (!here) return;
      const root = getComputedStyle(document.documentElement);
      const pinned = (parseFloat(root.getPropertyValue("--header-height")) || 0) + (parseFloat(root.getPropertyValue("--tools-height")) || 0);
      const pad = parseFloat(getComputedStyle(here.parentElement ?? here).paddingTop) || 0;
      const at = here.getBoundingClientRect().top - pad;
      // With nothing pinned (the playground), the view's place is where it starts.
      const under = pinned > 0 ? pinned : at + window.scrollY;
      const room = here.closest("main")?.parentElement?.getBoundingClientRect();
      const next = { top: Math.max(pinned > 0 ? pinned : 0, at), left: Math.max(0, room?.left ?? 0), right: Math.max(0, innerWidth - (room?.right ?? innerWidth)), tall: Math.max(0, innerHeight - under) };
      setBox((was) => was && Math.abs(was.top - next.top) < 0.5 && Math.abs(was.left - next.left) < 0.5 && Math.abs(was.right - next.right) < 0.5 && Math.abs(was.tall - next.tall) < 0.5 ? was : next);
      setDock(parseFloat(getComputedStyle(here).getPropertyValue("--dock-height")) || 0);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const watch = new MutationObserver(measure);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); watch.disconnect(); };
  }, []);
  const top = box?.top ?? null;
  // Once the canvas has its height, the page scrolls (once) so it starts right under what's pinned: an open Apps panel
  // above it goes up out of the way, as it would over the map.
  useLayoutEffect(() => {
    if (opened.current || !box?.tall || !anchor.current) return;
    opened.current = true;
    const root = getComputedStyle(document.documentElement);
    const pinned = (parseFloat(root.getPropertyValue("--header-height")) || 0) + (parseFloat(root.getPropertyValue("--tools-height")) || 0);
    const pad = parseFloat(getComputedStyle(anchor.current.parentElement ?? anchor.current).paddingTop) || 0;
    const at = anchor.current.getBoundingClientRect().top - pad;
    if (pinned > 0 && at > pinned + 1) window.scrollTo({ top: window.scrollY + at - pinned, behavior: "instant" });
  }, [box?.tall]);
  // A minute's tick keeps "12 min ago" true.
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  // What's placed: the map's, with this window's last moves until the map has them (no jump back while it answers).
  const dragging = drag ? grip.current : null;
  const positions = useMemo(() => {
    const merged: Record<string, Position> = { ...map.positions };
    for (const [id, p] of Object.entries(pending)) { if (p) merged[id] = p; else delete merged[id]; }
    if (dragging) { if (dragging.was) merged[dragging.id] = dragging.was; else delete merged[dragging.id]; }
    return merged;
  }, [map.positions, pending, dragging]);
  useEffect(() => setPending((was) => {
    const next = { ...was };
    for (const [id, p] of Object.entries(was)) {
      const there = map.positions[id];
      if (p ? there && there.x === p.x && there.y === p.y : !there) delete next[id];
    }
    return Object.keys(next).length === Object.keys(was).length ? was : next;
  }), [map.positions]);

  const layout = useMemo(() => place({ threads: map.threads, thoughts: map.thoughts, notes: map.notes, rooms: map.rooms, positions, shelf: shelf.items, open: open?.id ?? null }),
    [map.threads, map.thoughts, map.notes, map.rooms, positions, shelf.items, open?.id]);
  const hereKey = map.active ? layout.tips.get(map.active) : undefined;
  const here = hereKey ? layout.byKey.get(hereKey) : undefined;

  // New things arrive softly (for as long as their arrival takes, 0.6 s at most); what was there when the view opened
  // doesn't.
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef(new Set<number>());
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  useEffect(() => {
    const keys = layout.items.map((item) => item.key).concat(layout.links.map((link) => link.key));
    if (!seen.current) { seen.current = new Set(keys); return; }
    const added = keys.filter((key) => !seen.current!.has(key));
    if (!added.length) return;
    for (const key of added) seen.current.add(key);
    setFresh((was) => new Set([...was, ...added]));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setFresh((was) => new Set([...was].filter((key) => !added.includes(key))));
    }, 1000);
    timers.current.add(timer);
  }, [layout]);

  // The tangent you're in opens while the view follows you; leaving it closes it again, unless you opened it.
  const activeThread = map.threads.find((t) => t.id === map.active);
  useEffect(() => {
    if (!following || !activeThread) return;
    if (activeThread.parent_id && map.threads.some((t) => t.id === activeThread.parent_id)) setOpen((was) => was?.by === "you" && was.id !== activeThread.id ? was : { id: activeThread.id, by: "follow" });
    else setOpen((was) => (was?.by === "follow" ? null : was));
  }, [activeThread?.id, activeThread?.parent_id, following]);

  // What a drag carries: the thing held, and whatever is laid out from it (a topic's points and tangents).
  const children = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const item of layout.items) if (item.up && !item.pinned) out.set(item.up, [...(out.get(item.up) ?? []), item.key]);
    return out;
  }, [layout]);
  const group = useMemo(() => {
    if (!drag) return null;
    const keys = new Set([drag.key]);
    const queue = [drag.key];
    while (queue.length) for (const key of children.get(queue.pop()!) ?? []) if (!keys.has(key)) { keys.add(key); queue.push(key); }
    return keys;
  }, [drag?.key, children]);
  const held = useMemo(() => {
    if (!drag || !group) return null;
    const out = new Map<string, { x: number; y: number }>();
    for (const key of group) {
      const item = layout.byKey.get(key);
      if (item) out.set(key, { x: item.box.x + drag.dx, y: item.box.y + drag.dy });
    }
    return out;
  }, [drag, group, layout]);
  const shown = useGlide(layout, reduced, held);
  const at = (item: Item) => held?.get(item.key) ?? shown.get(item.key) ?? item.box;

  // The camera. `aim` puts a box where you'd look for it; `show` only when it isn't comfortably in view already.
  const area = () => {
    const box = frame.current?.getBoundingClientRect();
    return { w: box?.width ?? innerWidth, h: Math.max(120, (box?.height ?? innerHeight) - dock) };
  };
  const glide = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    return { duration: reduced ? 0 : Math.round(Math.min(900, 280 + distance * 0.35)), interpolate: distance > area().w ? "smooth" as const : "linear" as const, ease };
  };
  const aim = useCallback((box: Box, zoomTo?: number) => {
    const { w, h } = area();
    const was = flow.getViewport();
    const zoom = zoomTo ?? (was.zoom < READ ? 1 : was.zoom);
    const next = { x: w / 2 - (box.x + box.w / 2) * zoom, y: h * AIM - (box.y + box.h / 2) * zoom, zoom };
    void flow.setViewport(next, glide(was, next));
  }, [flow, dock, reduced]);
  const show = useCallback((box: Box) => {
    const { w, h } = area();
    const { x, y, zoom } = flow.getViewport();
    const sx = box.x * zoom + x, sy = box.y * zoom + y;
    const inside = sx >= w * COMFORT.left && sx + box.w * zoom <= w * COMFORT.right && sy >= h * COMFORT.top && sy + Math.min(box.h * zoom, h * 0.3) <= h * COMFORT.bottom;
    if (!inside || zoom < READ) aim(box);
  }, [aim, flow, dock]);
  const seeAll = useCallback(() => {
    const all = bounds(layout.items.map((item) => item.box));
    const { w, h } = area();
    const zoom = Math.max(0.05, Math.min(1, (w - 64) / Math.max(all.w, 1), (h - 64) / Math.max(all.h, 1)));
    const was = flow.getViewport();
    const next = { x: w / 2 - (all.x + all.w / 2) * zoom, y: h / 2 - (all.y + all.h / 2) * zoom, zoom };
    void flow.setViewport(next, glide(was, next));
  }, [layout, flow, dock, reduced]);
  const minZoom = useMemo(() => {
    const all = bounds(layout.items.map((item) => item.box));
    const { w, h } = area();
    return Math.max(0.04, Math.min(0.5, 0.8 * Math.min((w - 64) / Math.max(all.w, 1), (h - 64) / Math.max(all.h, 1))));
  }, [layout, dock, top]);

  // Opening: your latest point at reading size, or the whole map when you're nowhere yet; shown once it's there.
  useEffect(() => {
    if (ready || top === null) return;
    if (here) aim(here.box, 1); else seeAll();
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [top, ready]);
  // Following: where you are stays in view as you talk.
  useEffect(() => {
    if (ready && following && here && !drag) show(here.box);
  }, [ready, following, here?.key, here?.box.x, here?.box.y, here?.box.h]);

  // A thought landing: its point (or its closed card) pulses once; off screen, an arrow at the edge says where.
  useBrickEvent(on, "landed", ({ thoughtId, threadId, mine }) => {
    const item = layout.items.find((i) => i.kind === "point" && i.thoughts?.includes(thoughtId)) ?? layout.byKey.get(`t:${threadId}`);
    if (item) setPulses((was) => ({ ...was, [item.key]: (was[item.key] ?? 0) + 1 }));
    const quiet = Date.now() - touched.current > quietFor();
    if (mine && !following && quiet) setFollowing(true);
    else if (item && !(mine && following) && !onScreen(item.box)) {
      const title = map.threads.find((t) => t.id === threadId)?.title ?? "";
      setCues((was) => [...was.filter((cue) => cue.key !== item.key), { key: item.key, title, until: Date.now() + Math.max(SHORTEST_MS, readMs(title)) }].slice(-4));
    }
  });
  useEffect(() => {
    if (!cues.length) return;
    const next = Math.min(...cues.map((cue) => cue.until)) - Date.now();
    const timer = window.setTimeout(() => setCues((was) => was.filter((cue) => cue.until > Date.now())), Math.max(50, next));
    return () => window.clearTimeout(timer);
  }, [cues]);
  const onScreen = (box: Box) => {
    const { w, h } = area();
    const { x, y, zoom } = flow.getViewport();
    const sx = box.x * zoom + x, sy = box.y * zoom + y;
    return sx + box.w * zoom > 0 && sx < w && sy + box.h * zoom > 0 && sy < h;
  };
  /** A quiet moment: long enough since you last moved the canvas to have read what's in the middle of it. */
  const quietFor = () => {
    const { w, h } = area();
    const { x, y, zoom } = flow.getViewport();
    let best: Item | undefined;
    let nearest = Infinity;
    for (const item of layout.items) {
      const d = Math.hypot(item.box.x * zoom + x + (item.box.w * zoom) / 2 - w / 2, item.box.y * zoom + y + (item.box.h * zoom) / 2 - h / 2);
      if (d < nearest) { nearest = d; best = item; }
    }
    return readMs(`${best?.title ?? ""} ${best?.text ?? ""} ${best?.latest ?? ""}`);
  };
  const stopFollowing = () => { touched.current = Date.now(); setFollowing(false); };

  // A move, at once on screen, then on the map for every window. Offline it can't go: it says so and stays put.
  const put = useCallback((id: string, x: number | null, y: number | null) => {
    if (!map.connected) { actions.notify("Not connected: it stays where it was until this window reconnects."); return false; }
    setPending((was) => ({ ...was, [id]: x === null || y === null ? null : { x, y, by: map.me, at_ms: Date.now() } }));
    actions.position(id, x, y);
    return true;
  }, [actions, map.me, map.connected]);
  const keep = (id: string) => shelf.add(id);

  const acts = useMemo<Acts>(() => ({
    toggle: (thread) => { stopFollowing(); setOpen((was) => (was?.id === thread ? null : { id: thread, by: "you" })); },
    pick: (item) => { touched.current = Date.now(); setPicked(item.key); actions.select(item.thread); },
    // Reached by Tab: brought into view, as a pointer would have to go there.
    focus: (item) => { if (!onScreen(item.box)) { stopFollowing(); show(item.box); } },
    openOnMap: (thread) => actions.openThread(thread),
    shelve: (item) => keep(item.id),
    unpin: (item) => { put(item.id, null, null); },
  }), [actions, put, shelf.items]);

  const datas = useMemo(() => new Map(layout.items.map((item): [string, ItemData] =>
    [item.key, { item, here: item.key === hereKey, pulse: pulses[item.key] ?? 0, fresh: fresh.has(item.key), picked: picked === item.key }])),
  [layout, hereKey, pulses, fresh, picked]);
  const nodes: ItemNode[] = layout.items.map((item) => ({
    // Its size is known before it's drawn (layout.ts): said as measured, the canvas never measures it again (a node
    // without it is measured on every update, and a moving canvas would loop the browser's resize observer).
    id: item.key, type: "item", position: at(item), data: datas.get(item.key)!, width: item.box.w, height: item.box.h, measured: { width: item.box.w, height: item.box.h },
    draggable: item.kind !== "notch", selectable: false, focusable: false, connectable: false,
    // Heads over points: far out, a topic's title covers the top of its own spine (in reach of a point, never at it).
    zIndex: (item.kind === "notch" ? 0 : item.kind === "card" ? 1 : item.kind === "point" ? (item.look?.variant === "mini" ? 3 : 2) : 4) + (item.pinned ? 5 : 0) + (group?.has(item.key) ? 20 : 0),
  }));

  // A drag: the thing follows the hand (with what's laid out from it), and every window sees each step.
  const onNodesChange = useCallback((changes: NodeChange<ItemNode>[]) => {
    for (const change of changes) {
      if (change.type !== "position" || !change.position || !change.dragging) continue;
      const item = layout.byKey.get(change.id);
      if (!item) continue;
      if (grip.current?.id !== item.id) grip.current = { id: item.id, was: map.positions[item.id] };
      setDrag({ key: item.key, dx: change.position.x - item.box.x, dy: change.position.y - item.box.y });
      if (map.connected) actions.position(item.id, change.position.x, change.position.y);
    }
  }, [layout, map.positions, map.connected, actions]);
  const pointer = (event: MouseEvent | TouchEvent) => ("touches" in event ? event.changedTouches[0] : event);
  const overShelfAt = (event: MouseEvent | TouchEvent) => {
    const box = shelfRef.current?.getBoundingClientRect();
    const { clientX, clientY } = pointer(event);
    return !!box && clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
  };

  const linkEnd = (link: Link) => (end: End) => {
    const item = layout.byKey.get(end.key);
    if (!item) return null;
    // A spine doesn't stretch after one point pulled off it: its line stays where its points are.
    const other = end === link.from ? link.to : link.from;
    const p = link.kind === "spine" && group?.has(end.key) && !group.has(other.key) ? shown.get(item.key) ?? item.box : at(item);
    return { x: p.x + end.dx, y: p.y + end.dy };
  };

  const ready_ = ready && top !== null;
  return <div className="spine">
    <div ref={anchor} className="spine-anchor" style={{ height: box?.tall ?? 0 }} />
    <div ref={frame} className={cls("spine-frame", ready_ && "spine-ready")} style={{ top: top ?? 0, left: box?.left ?? 0, right: box?.right ?? 0 }}
      onKeyDown={(event) => {
        if ((event.target as Element).closest("input, textarea")) return;
        if (event.key === "+" || event.key === "=") void flow.zoomIn({ duration: reduced ? 0 : 200 });
        else if (event.key === "-") void flow.zoomOut({ duration: reduced ? 0 : 200 });
        else if (event.key === "0") seeAll();
        else return;
        stopFollowing();
      }}>
      <ActsContext.Provider value={acts}>
      <NowContext.Provider value={now}>
      <ReactFlow<ItemNode>
        className="spine-flow" nodes={nodes} edges={[]} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange}
        onNodeDragStart={() => stopFollowing()}
        onNodeDrag={(event) => setOverShelf(overShelfAt(event))}
        onNodeDragStop={(event, node) => {
          const item = layout.byKey.get(node.id);
          const was = grip.current;
          grip.current = null;
          setDrag(null);
          setOverShelf(false);
          if (!item) return;
          // Onto the shelf: kept there, and its place on the canvas is what it was before the drag.
          if (overShelfAt(event)) {
            keep(item.id);
            if (was?.id === item.id) put(item.id, was.was?.x ?? null, was.was?.y ?? null);
          } else put(item.id, node.position.x, node.position.y);
        }}
        onMoveStart={(event) => { if (event) stopFollowing(); }}
        onPaneClick={() => setPicked(null)}
        minZoom={minZoom} maxZoom={2} nodeDragThreshold={DRAG}
        panOnScroll zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} elementsSelectable={false}
        nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} proOptions={{ hideAttribution: true }}
        aria-label="Your threads as spines: drag the canvas to look around, pinch or Ctrl and scroll to zoom">
        <ZoomVar />
        <EdgeLabelRenderer>
          <svg className="spine-links" aria-hidden="true">
            {layout.links.map((link) => {
              const d = pathOf(link, linkEnd(link));
              const drawn = fresh.has(link.key) && link.kind !== "pulled";
              return d && <path key={link.key} d={d} className={cls("spine-link", LINK_CLASS[link.kind], drawn && "spine-draw")}
                pathLength={drawn ? 1 : undefined} style={{ stroke: link.room ? `var(--room-${link.room})` : undefined }} />;
            })}
          </svg>
        </EdgeLabelRenderer>
      </ReactFlow>
      <Cues cues={cues} layout={layout} area={area} go={(item) => { setCues((was) => was.filter((cue) => cue.key !== item.key)); stopFollowing(); aim(item.box); }} />
      </NowContext.Provider>
      </ActsContext.Provider>
      {!following && here && <button type="button" className="spine-follow" style={{ bottom: dock + 12 }}
        onClick={() => { setFollowing(true); aim(here.box); }}>
        <span className="spine-follow-dot" aria-hidden="true" />Follow · {activeThread?.title}
      </button>}
      <div className="spine-corner" style={{ bottom: dock + 12 }}>
      <div className="spine-controls" role="group" aria-label="Canvas">
        <button type="button" className="spine-control" aria-label="Zoom in" title="Zoom in (+)" onClick={() => { stopFollowing(); void flow.zoomIn({ duration: reduced ? 0 : 200 }); }}>+</button>
        <button type="button" className="spine-control" aria-label="Zoom out" title="Zoom out (−)" onClick={() => { stopFollowing(); void flow.zoomOut({ duration: reduced ? 0 : 200 }); }}>−</button>
        <button type="button" className="spine-control" aria-label="See everything" title="See everything (0)" onClick={() => { stopFollowing(); seeAll(); }}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <Shelf ref={shelfRef} entries={layout.shelf} carrying={!!drag} hot={overShelf}
        putBack={(id) => shelf.remove(id)}
        place={(id, x, y) => {
          const box = frame.current?.getBoundingClientRect();
          const p = flow.screenToFlowPosition({ x, y });
          if (box && y < box.bottom - dock && put(id, p.x - G.lineX, p.y - G.dotY)) shelf.remove(id);
        }} />
      </div>
    </div>
  </div>;
}

const NODE_TYPES = { item: ItemView };

/** The zoom, as `--spine-k` (1 / zoom), for what keeps its size on screen however far out you are (a topic's title). */
function ZoomVar() {
  const store = useStoreApi();
  useEffect(() => {
    let last = 0;
    const set = (zoom: number) => {
      if (zoom === last) return;
      last = zoom;
      store.getState().domNode?.style.setProperty("--spine-k", String(1 / zoom));
    };
    set(store.getState().transform[2]);
    return store.subscribe((state) => set(state.transform[2]));
  }, [store]);
  return null;
}

/** Where a new thing landed out of view: an arrow at the edge of the screen, toward it, with its thread's title. */
function Cues({ cues, layout, area, go }: { cues: { key: string; title: string }[]; layout: Layout; area: () => { w: number; h: number }; go: (item: Item) => void }) {
  const [x, y, zoom] = useStore((s) => s.transform);
  if (!cues.length) return null;
  const { w, h } = area();
  const inset = 16;
  const placed: { left: number; top: number }[] = [];
  return <div className="spine-cues">
    {cues.map((cue) => {
      const item = layout.byKey.get(cue.key);
      if (!item) return null;
      const cx = (item.box.x + item.box.w / 2) * zoom + x;
      const cy = (item.box.y + item.box.h / 2) * zoom + y;
      if (cx > 0 && cx < w && cy > 0 && cy < h) return null;
      // Along the line from the middle of the screen toward it, stopped at the edge.
      const dx = cx - w / 2, dy = cy - h / 2;
      const scale = Math.min((w / 2 - inset - 90) / Math.max(Math.abs(dx), 1), (h / 2 - inset - 18) / Math.max(Math.abs(dy), 1));
      let left = w / 2 + dx * scale, top = h / 2 + dy * scale;
      // Several pointing the same way stack, a row apart, never on top of each other.
      while (placed.some((p) => Math.abs(p.left - left) < 120 && Math.abs(p.top - top) < 30)) top += top > h / 2 ? -34 : 34;
      placed.push({ left, top });
      const angle = Math.atan2(dy, dx);
      return <button key={cue.key} type="button" className="spine-cue" style={{ left, top }} onClick={() => go(item)}
        aria-label={`New on ${cue.title}: go there`}>
        <span className="spine-cue-arrow" style={{ transform: `rotate(${angle}rad)` }} aria-hidden="true">➜</span>
        <span className="spine-cue-title">{cue.title}</span>
      </button>;
    })}
  </div>;
}
