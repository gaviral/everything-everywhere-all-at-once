// The Spine: the map as one canvas you can pan and zoom without end. Each topic is a spine of its points, oldest at
// the top; each tangent hangs beside the point it came from (layout.ts). The camera follows what you're talking about
// and lets go the moment a hand moves the map (camera.ts). Your thought on its way has a dashed slot where it's
// expected (`data-slot="slot:<thought id>"`, what the bubble flight aims at); the newest landing rings once and says what
// put it there and how fast; what lands out of view gets an edge chip until you've seen it (cues.tsx). Words in a point
// can be answered in a margin note (margin.tsx). Anything can be dragged where you want it and stays there
// (map.positions), and the shelf keeps things at hand while the canvas moves. A view brick (docs/bricks.md): its name
// joins Map and Palace.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, EdgeLabelRenderer, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useStoreApi, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useBrickEvent, type BrickEvents, type BrickProps, type Position } from "../contract";
import { useCamera, type Area } from "./camera";
import { Corner, type Stop } from "./corner";
import { Cues, onScreen, type Cue } from "./cues";
import { bounds, G, layout as place, type Box, type End, type Item, type Layout, type Link } from "./layout";
import { Reply, useMargins, type Picking } from "./margin";
import { ActsContext, ItemView, NowContext, READ, type Acts, type ItemData, type ItemNode } from "./nodes";
import { Shelf } from "./shelf";
import { useStayingHere } from "../../StayHere";
import "./spine.css";

/** A press that moves less than this is a click, not a drag: a hand's wobble on a click is 1–3 px. */
const DRAG = 4;
/** Things making room glide this long (Material's standard duration for elements moving on screen, 300 ms); under
 *  Reduce Motion they cross-fade in half that. */
const GLIDE_MS = 300;
const FADE_MS = 150;
/** Reading, as the app's notices count it (notice-rules.ts): 238 words a minute (Brysbaert 2019), a 200 ms look first. */
const READ_WPM = 238;
const LOOK_MS = 200;
const readMs = (text: string) => LOOK_MS + Math.round((text.trim().split(/\s+/).filter(Boolean).length * 60_000) / READ_WPM);
/** A thought that landed while its bubble is still in the air keeps its slot open this long at most: the longest
 *  flight (640 ms) and a frame. */
const ARRIVE_MAX_MS = 700;
/** Your thoughts on their way that get a slot each; more wait in the status line's count. */
const SLOTS_MAX = 3;
/** Narrower than this is a phone: notes tuck under their words, edge chips line up above the composer. */
const NARROW = 560;
/** The camera's corner (left) needs this much beside the stage, else it sits above it; the shelf (right) needs
 *  SHELF_W, each from its own side of the stage: a lane at the page's right (the Work spine's) narrows only that side. */
const CORNER_W = 330;
const SHELF_W = 110;
const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");
const LINK_CLASS: Record<Link["kind"], string> = { spine: "spine-link-spine", branch: "spine-link-branch", pulled: "spine-link-pulled", slot: "spine-link-slot", note: "spine-link-note" };

export default function Spine(props: BrickProps) {
  if (!props.map.threads.length) return <p className="spine-empty">Nothing on the map yet. Say or type a thought, and its topic starts here.</p>;
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

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Things move to their new places together, over GLIDE_MS, instead of jumping; `held` are where a hand holds them now
 *  (a drag), and the next glide starts from there. Under Reduce Motion they're at their new places at once and fade in
 *  there (`fadeIn`), so nothing slides. */
function useGlide(layout: Layout, reduced: boolean, held: Map<string, { x: number; y: number }> | null, fadeIn: (keys: string[]) => void) {
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
      if (moving.length) {
        tick((n) => n + 1);
        if (!held) fadeIn(moving.map(([key]) => key));
      }
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / GLIDE_MS);
      const e = easeInOut(t);
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

/** A link's path, from where its two ends are shown. A spine and its run on to a slot go straight down; a tangent's
 *  curve runs straight along its point's row into the gutter first, then bends there, so it never crosses a column's
 *  words; a note's string leaves its words sideways. */
function pathOf(link: Link, at: (end: End) => { x: number; y: number } | null) {
  const a = at(link.from);
  const b = at(link.to);
  if (!a || !b) return null;
  if (link.kind === "spine" || link.kind === "slot") return `M${a.x} ${a.y}V${b.y}`;
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
  // Another map: its own shelf, read once, not on every render (the layout redoes everything when this changes).
  const fresh = useMemo(() => (held.key === key ? null : read(key)), [held.key, key]);
  const items = fresh ?? held.items;
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

/** "Muse Spark 1.3 put this here in 2.6 s": the landing note, from the model's id and the placing's time. */
export function landingNote(model: string | undefined, ms: number | null | undefined) {
  // "muse-spark-1.3-contributor" → "Muse Spark 1.3": the public name (contributor mode is how the key asks, not a model).
  const name = model ? (model.includes(" ") ? model : model.split("-").filter((part) => part && part !== "contributor")
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1))).join(" ")) : "";
  const time = typeof ms === "number" && ms > 0 ? `${(ms / 1000).toFixed(1)} s` : "";
  if (name) return time ? `${name} put this here in ${time}` : `${name} put this here`;
  return time ? `Put here in ${time}` : "";
}

/** What floats over the canvas at its edges: the shell's four corners (their slots), the Talk pill under Find and
 *  Catalog, the guide's held questions, and the canvas's own corners. */
const COVERS = '[data-slot="top-left"], [data-slot="top-right"], [data-slot="bottom-left"], [data-slot="bottom-right"], [data-slot="held"], .talk-pill, .guide-held, .spine-corner';

/** The page's slots (contract.ts `SlotName`), measured: where the stage starts, how tall the status line is. */
function chromeOf(frameBox: DOMRect | undefined) {
  const stage = document.querySelector('[data-slot="stage"]')?.getBoundingClientRect();
  const status = document.querySelector('[data-slot="status"]')?.getBoundingClientRect();
  // An empty stage still belongs to the shell: its input now lives in the bottom bar. Keep the camera and shelf in
  // their separate corners, rather than crowding both into the classic page's right corner and taking chips' slots.
  return { stage: stage && stage.width ? stage : null, status: status?.height ?? 0, frame: frameBox };
}

function Canvas({ map, actions, on, destination }: BrickProps) {
  const flow = useReactFlow<ItemNode>();
  const staying = useStayingHere();
  const reduced = useReducedMotion();
  const shelf = useShelf(map);
  const notes = useMargins(map, actions);
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(0);
  const [corner, setCorner] = useState({ bottom: 12, bottomRight: 12, row: 12, shell: false });
  const [open, setOpen] = useState<{ id: string; by: "follow" | "you" } | null>(null);
  const [following, setFollowing] = useState(true);
  const [originals, setOriginals] = useState<ReadonlySet<string>>(new Set());
  const [handMoving, setHandMoving] = useState(false);
  const [heldAt, setHeldAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Position | null>>({});
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  // While a hand holds something, the map's echoes of its own steps don't move it under the hand: it stays where it was
  // when the drag began (`grip`), and lands where it's dropped.
  const grip = useRef<{ id: string; was: Position | undefined } | null>(null);
  const [overShelf, setOverShelf] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [cues, setCues] = useState<Cue[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const [stop, setStop] = useState<Stop>("words");
  const [landing, setLanding] = useState<{ thought: string; text: string } | null>(null);
  const [arriving, setArriving] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState<{ key: string; thoughtId: string } | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [pointing, setPointing] = useState<{ thread: string } | null>(null);
  // A spine moved under another topic, shown there at once until the map says so (a refused move lets go).
  const [moving, setMoving] = useState<Record<string, string>>({});
  // The named topic a carried spine is over, while it's carried: dropped, it goes under it.
  const [dropTo, setDropTo] = useState<string | null>(null);
  const touched = useRef(0);
  const timers = useRef(new Set<number>());
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  const later = (run: () => void, ms: number) => {
    const timer = window.setTimeout(() => { timers.current.delete(timer); run(); }, ms);
    timers.current.add(timer);
    return timer;
  };

  // The canvas fills the window under what stays pinned at its top (the header and the tools, where the app has them),
  // as wide as the place the page gives a view, and the dock or stage floats over its foot. What scrolls above the view
  // (the Apps panel) pushes it down until the page is scrolled; opening, the page scrolls so the canvas has the whole
  // window.
  const [box, setBox] = useState<{ top: number; left: number; right: number; tall: number; width: number } | null>(null);
  const opened_ = useRef(false);
  useLayoutEffect(() => {
    const measure = () => {
      const here = anchor.current;
      if (!here) return;
      const root = getComputedStyle(document.documentElement);
      const pinned = (parseFloat(root.getPropertyValue("--header-height")) || 0) + (parseFloat(root.getPropertyValue("--tools-height")) || 0);
      const pad = parseFloat(getComputedStyle(here.parentElement ?? here).paddingTop) || 0;
      const at = here.getBoundingClientRect().top - pad;
      // With nothing pinned (the playground, the new shell), the view's place is where it starts.
      const under = pinned > 0 ? pinned : at + window.scrollY;
      const room = here.closest("main")?.parentElement?.getBoundingClientRect();
      const next = { top: Math.max(pinned > 0 ? pinned : 0, at), left: Math.max(0, room?.left ?? 0), right: Math.max(0, innerWidth - (room?.right ?? innerWidth)), tall: Math.max(0, innerHeight - under), width: innerWidth };
      setBox((was) => was && Math.abs(was.top - next.top) < 0.5 && Math.abs(was.left - next.left) < 0.5 && Math.abs(was.right - next.right) < 0.5 && Math.abs(was.tall - next.tall) < 0.5 && was.width === next.width ? was : next);
      const docked = parseFloat(getComputedStyle(here).getPropertyValue("--dock-height")) || 0;
      setDock(docked);
      // The corners: beside the shell's stage, above its status line, when there's room; else above the stage (or the
      // app's dock).
      const chrome = chromeOf(frame.current?.getBoundingClientRect());
      const bottomEdge = chrome.frame?.bottom ?? innerHeight;
      // The frame's sides as this measure has them (the frame itself follows on the next render).
      const bottom = chrome.stage
        ? (chrome.stage.left - next.left >= CORNER_W ? chrome.status + 12 : bottomEdge - chrome.stage.top + 8)
        : docked + 12;
      const bottomRight = chrome.stage
        ? (innerWidth - next.right - chrome.stage.right >= SHELF_W ? chrome.status + 12 : bottomEdge - chrome.stage.top + 8)
        : docked + 12;
      const row = chrome.stage ? bottomEdge - chrome.stage.top + 8 : docked + 8;
      const shell = !!chrome.stage;
      setCorner((was) => (was.bottom === bottom && was.bottomRight === bottomRight && was.row === row && was.shell === shell ? was : { bottom, bottomRight, row, shell }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const watch = new MutationObserver(measure);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); watch.disconnect(); };
  }, []);
  const top = box?.top ?? null;
  const width = box ? box.width - box.left - box.right : innerWidth;
  const narrow = width < NARROW;
  // Once the canvas has its height, the page scrolls (once) so it starts right under what's pinned: an open Apps panel
  // above it goes up out of the way, as it would over the map.
  useLayoutEffect(() => {
    if (opened_.current || !box?.tall || !anchor.current) return;
    opened_.current = true;
    const root = getComputedStyle(document.documentElement);
    const pinned = (parseFloat(root.getPropertyValue("--header-height")) || 0) + (parseFloat(root.getPropertyValue("--tools-height")) || 0);
    const pad = parseFloat(getComputedStyle(anchor.current.parentElement ?? anchor.current).paddingTop) || 0;
    const at = anchor.current.getBoundingClientRect().top - pad;
    if (pinned > 0 && at > pinned + 1) window.scrollTo({ top: window.scrollY + at - pinned, behavior: "instant" });
  }, [box?.tall]);
  // A minute's tick keeps "12 min ago" true.
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  /** The part of the canvas nothing covers, in its own pixels: above the stage (or the dock), left of a rail. */
  const area = useCallback((): Area => {
    const frameBox = frame.current?.getBoundingClientRect();
    const w = frameBox?.width ?? innerWidth, h = frameBox?.height ?? innerHeight;
    const chrome = chromeOf(frameBox);
    // The rail (`data-slot="rail"`, the panel at the right) once the page has one: the camera keeps clear of it.
    const rail = document.querySelector('[data-slot="rail"]')?.getBoundingClientRect();
    // The shell's top buttons and Talk pill float over the map. Leave their measured band clear, just as we do the input.
    const topCovers = [...document.querySelectorAll('[data-slot="top-left"], [data-slot="top-right"], .talk-pill')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
    const y0 = Math.max(0, ...topCovers.map((r) => r.bottom - (frameBox?.top ?? 0) + 8));
    const y1 = chrome.stage?.height ? Math.min(h, chrome.stage.top - (frameBox?.top ?? 0) - 8) : h - dock;
    const x1 = rail && rail.width && rail.left > (frameBox?.left ?? 0) + w / 2 ? rail.left - (frameBox?.left ?? 0) - 8 : w;
    return { x0: 0, y0, x1: Math.max(160, x1), y1: Math.max(y0 + 120, y1) };
  }, [dock]);

  /** What floats over the canvas, in its pixels: the shell's corners (Find, Catalog, the people in a call), the Talk
   *  pill, the held questions, and this canvas's own corners (Follow, the views, the shelf). An edge chip under any of
   *  them couldn't be pressed, so the chips keep clear (cues.tsx). */
  const avoid = useCallback((): Area[] => {
    const f = frame.current?.getBoundingClientRect();
    if (!f) return [];
    const out: Area[] = [];
    for (const el of document.querySelectorAll(COVERS)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x0: r.left - f.left, y0: r.top - f.top, x1: r.right - f.left, y1: r.bottom - f.top });
    }
    return out;
  }, []);

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

  // Your thoughts on their way: a slot each, under the tip of the thread you're on.
  const slots = useMemo(() => map.thoughts.filter((t) => !t.placed && !t.thread_id && t.speaker === map.me).slice(-SLOTS_MAX).map((t) => t.id), [map.thoughts, map.me]);
  const slotKey = slots.join("|");
  const threads = useMemo(() => {
    const shown = notes.anchored.size ? map.threads.filter((t) => !notes.anchored.has(t.id)) : map.threads;
    return Object.keys(moving).length ? shown.map((t) => (moving[t.id] && t.topic !== moving[t.id] ? { ...t, topic: moving[t.id] } : t)) : shown;
  }, [map.threads, notes.anchored, moving]);
  const topicNames = useMemo(() => map.topics.map((topic) => topic.name), [map.topics]);
  const layout = useMemo(() => place({ threads, thoughts: map.thoughts, notes: map.notes, rooms: map.rooms, positions, shelf: shelf.items, open: open?.id ?? null,
    me: map.me, speakers: map.speakers, active: staying ?? map.active, slots, landing, margins: notes.margins, opened, narrow, topics: topicNames, staying, originals }),
  [threads, map.thoughts, map.notes, map.rooms, positions, shelf.items, open?.id, map.me, map.speakers, map.active, slotKey, landing, notes.margins, opened, narrow, topicNames, staying, originals]);
  // A move the map now shows, or one that never came (refused, or the core away), stops being held.
  useEffect(() => {
    const ids = Object.keys(moving);
    if (!ids.length) return;
    const there = ids.filter((id) => map.threads.find((t) => t.id === id)?.topic === moving[id]);
    if (there.length) setMoving((was) => Object.fromEntries(Object.entries(was).filter(([id]) => !there.includes(id))));
    const timer = window.setTimeout(() => setMoving({}), 4000);
    return () => window.clearTimeout(timer);
  }, [map.threads, moving]);
  const hereKey = staying || map.active ? layout.tips.get((staying ?? map.active)!) : undefined;
  const here = hereKey ? layout.byKey.get(hereKey) : undefined;
  const slotsHere = map.active ? layout.slots.get(map.active) ?? [] : [];

  // New things arrive softly (for as long as their arrival takes, 0.6 s at most); what was there when the view opened
  // doesn't.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = layout.items.map((item) => item.key).concat(layout.links.map((link) => link.key));
    if (!seen.current) { seen.current = new Set(keys); return; }
    const added = keys.filter((key) => !seen.current!.has(key));
    if (!added.length) return;
    for (const key of added) seen.current.add(key);
    setFresh((was) => new Set([...was, ...added]));
    later(() => setFresh((was) => new Set([...was].filter((key) => !added.includes(key)))), 1000);
  }, [layout]);

  // The tangent you're in opens while the view follows you; leaving it closes it again, unless you opened it.
  const activeThread = map.threads.find((t) => t.id === (staying ?? map.active));
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
  const fadeIn = useCallback((keys: string[]) => requestAnimationFrame(() => {
    for (const key of keys) frame.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(key)}"]`)?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
  }), []);
  const shown = useGlide(layout, reduced, held, fadeIn);
  const at = (item: Item) => held?.get(item.key) ?? shown.get(item.key) ?? item.box;

  // The camera.
  const pane = useCallback(() => frame.current?.querySelector<HTMLElement>(".spine-flow") ?? null, []);
  const camera = useCamera(flow, area, reduced, pane);
  const all = () => bounds(layout.items.map((item) => item.box));
  const minZoom = useMemo(() => {
    const everything = all();
    const a = area();
    return Math.max(0.04, Math.min(0.5, 0.8 * Math.min((a.x1 - a.x0 - 64) / Math.max(everything.w, 1), (a.y1 - a.y0 - 64) / Math.max(everything.h, 1))));
  }, [layout, dock, top, area, width, box?.tall]);
  /** What the follow keeps in view: your latest point, with the slots under it. */
  const goal = () => {
    if (!here) return null;
    const boxes = [here.box, ...slotsHere.map((key) => layout.byKey.get(key)?.box).filter((b): b is Box => !!b)];
    if (staying) boxes.push(...layout.items.filter((item) => item.kind === "margin" && item.up === here.key).map((item) => item.box));
    return { box: bounds(boxes), ring: here.key };
  };
  const goalNow = useRef(goal);
  // Words being picked or answered keep the view where it is.
  goalNow.current = () => (following && !drag && !selecting && !picking ? goal() : null);
  const followBox = goal()?.box;

  // Opening: your latest point at reading size, or the whole map when you're nowhere yet; shown once it's there.
  useEffect(() => {
    if (ready || top === null) return;
    const g = goal();
    if (g) camera.aim(g.box, { zoom: 1, instant: true }); else camera.fit(all(), 1, minZoom, { instant: true });
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [top, ready]);
  // Follow the active words on resize; a held view keeps its center and zoom.
  // Fitting everything while held would dismiss unread edge cues without the person going there.
  const previousSize = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!box) return;
    const previous = previousSize.current;
    previousSize.current = { width, height: box.tall };
    if (!ready) return;
    if (!following && previous) {
      const view = flow.getViewport();
      void flow.setViewport({ ...view, x: view.x + (width - previous.width) / 2, y: view.y + (box.tall - previous.height) / 2 }, { duration: 0 });
      return;
    }
    const g = goal();
    if (g) camera.aim(g.box, { instant: true }); else camera.fit(all(), 1, minZoom, { instant: true });
  }, [width, box?.tall]);
  // Following: where you are stays in view as you talk (the camera spaces and limits the moves).
  // The canvas itself getting wider or narrower (a lane taking the page's right side, or giving it back) is a reason to
  // look again: what you're on may no longer be in the comfortable middle.
  useEffect(() => {
    if (ready && following && here && !drag) camera.follow(() => goalNow.current());
  }, [ready, following, here?.key, followBox?.x, followBox?.y, followBox?.w, followBox?.h, slotsHere.join("|"), box?.left, box?.right]);

  // A tangent you opened comes into view if it's out of it (on a phone, a tucked one opens beside its topic).
  useEffect(() => {
    if (open?.by !== "you" || !ready) return;
    const card = layout.byKey.get(`t:${open.id}`);
    if (card && !camera.comfortable(card.box)) camera.aim(card.box, { ring: card.key });
  }, [open?.id, open?.by]);

  // Find and return name their destination, rather than the active thread's newest point. Keep the request across
  // a lazy mount, wait for its layout, and cancel any queued follow so a held camera still goes exactly there.
  const reached = useRef<BrickProps["destination"]>(null);
  useEffect(() => {
    if (!ready || !destination || reached.current === destination) return;
    const { thoughtId, threadId } = destination;
    const point = thoughtId ? layout.items.find((item) => item.thoughts?.includes(thoughtId)) : undefined;
    const thread = map.threads.find((thread) => thread.id === threadId);
    if (!point && thoughtId && thread?.parent_id && open?.id !== thread.id) {
      setOpen({ id: thread.id, by: "follow" });
      return;
    }
    const item = point ?? layout.byKey.get(`t:${threadId}`);
    if (!item) return;
    setFollowing(false);
    camera.hold();
    if (point && !originals.has(point.id)) {
      setOriginals((was) => new Set([...was, point.id]));
      return; // Aim after the original words have their measured space.
    }
    reached.current = destination;
    camera.aim(item.box, { ring: item.key });
  }, [ready, destination, layout, map.threads, open?.id, originals, camera.aim]);

  const touch = () => { touched.current = Date.now(); setHeldAt(touched.current); };
  const stopFollowing = () => { touch(); setFollowing(false); camera.hold(); };
  const startFollowing = () => {
    setFollowing(true);
    const g = goal();
    if (g) camera.aim(g.box, { ring: g.ring });
  };
  /** The item nearest the middle of the view. */
  const middle = () => {
    const a = area();
    const { x, y, zoom } = flow.getViewport();
    let best: Item | undefined;
    let nearest = Infinity;
    for (const item of layout.items) {
      const d = Math.hypot(item.box.x * zoom + x + (item.box.w * zoom) / 2 - (a.x0 + a.x1) / 2, item.box.y * zoom + y + (item.box.h * zoom) / 2 - (a.y0 + a.y1) / 2);
      if (d < nearest) { nearest = d; best = item; }
    }
    return best;
  };
  /** A quiet moment: enough still time to read the visible thoughts and their comments. */
  const quietFor = () => {
    const a = area(), v = flow.getViewport();
    const visible = layout.items.filter(({ box: b }) => b.x * v.zoom + v.x < a.x1 && (b.x + b.w) * v.zoom + v.x > a.x0
      && b.y * v.zoom + v.y < a.y1 && (b.y + b.h) * v.zoom + v.y > a.y0);
    return readMs(visible.map((item) => [item.title, item.shown ?? item.text, item.latest,
      ...(item.entries ?? []).map((entry) => entry.text), ...(item.tucks ?? []).flatMap((tuck) => tuck.entries.map((entry) => entry.text))].filter(Boolean).join(" ")).join(" "));
  };
  const transform = (): [number, number, number] => { const v = flow.getViewport(); return [v.x, v.y, v.zoom]; };

  // Stillness starts when the hand lets go, and lasts long enough to read what is actually in view.
  // Keep a pending follow even if no further thought arrives after that pause.
  useEffect(() => {
    if (!staying || following || handMoving || drag || selecting || picking) return;
    const timer = window.setTimeout(() => setFollowing(true), Math.max(0, heldAt + quietFor() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [staying, following, handMoving, drag, selecting, picking, heldAt, layout]);

  // A thought landing: its slot fills once its flight is in (a ring), the newest landing says what put it there, and
  // out of view an edge chip says where.
  const ring = (key: string) => {
    if (reduced) camera.flash(key);
    else setPulses((was) => ({ ...was, [key]: (was[key] ?? 0) + 1 }));
  };
  /** Its flight still in the air (the bubble flight's, `data-flight`). */
  const inAir = (thoughtId: string) => !!document.querySelector(`[data-flight="${CSS.escape(thoughtId)}"], [data-thought-id="${CSS.escape(thoughtId)}"]`);
  /** The slot stays open until the flight is in, never longer than a flight; then the point rings. */
  const arrive = (thoughtId: string, item: Item) => {
    setArriving(thoughtId);
    const began = Date.now();
    const check = () => {
      if (inAir(thoughtId) && Date.now() - began < ARRIVE_MAX_MS) { later(check, 40); return; }
      setArriving((was) => (was === thoughtId ? null : was));
      ring(item.key);
    };
    later(check, 40);
  };
  useBrickEvent(on, "landed", (event: BrickEvents["landed"]) => {
    // The model that placed it, and how long placing took; a rule's landing names no model (none is ever guessed).
    const { thoughtId, threadId, mine, model, ms } = event;
    const thought = map.thoughts.find((t) => t.id === thoughtId);
    // Yours: the model put your thought there, and you're the one waiting on it; another's landing gets its initial.
    if (mine) {
      const text = landingNote(model ?? undefined, ms ?? thought?.place_ms);
      setLanding(text ? { thought: thoughtId, text } : null);
    }
    const item = layout.items.find((i) => (i.kind === "point" || i.kind === "aside") && i.thoughts?.includes(thoughtId)) ?? layout.byKey.get(`t:${threadId}`);
    if (item) {
      if (mine && !reduced && inAir(thoughtId)) arrive(thoughtId, item);
      else ring(item.key);
    }
    const quiet = Date.now() - touched.current > quietFor();
    if (mine && !staying && !following && !handMoving && quiet) setFollowing(true);
    else if (item && !(mine && following) && !onScreen(item, transform(), area()).inside) {
      const title = map.threads.find((t) => t.id === threadId)?.title ?? "";
      setCues((was) => [...was.filter((cue) => cue.thread !== item.thread), { key: item.key, thread: item.thread, title, at: Date.now() }]);
    }
  });
  // Your first thought on an empty map: this view is only drawn once the map has a thread, so it mounts after that
  // thought landed (its `landed` came before this view was here) with its bubble waiting in the air. It arrives as a
  // later one does: the slot holds its place until the bubble is in.
  useEffect(() => {
    const flying = reduced ? [] : [...document.querySelectorAll("[data-flight]")].map((bubble) => bubble.getAttribute("data-flight"));
    const waiting = flying.length ? map.thoughts.find((t) => t.speaker === map.me && t.placed && flying.includes(t.id)) : undefined;
    const item = waiting && layout.items.find((i) => (i.kind === "point" || i.kind === "aside") && i.thoughts?.includes(waiting.id));
    if (waiting && item) arrive(waiting.id, item);
  }, []);
  // What the guide points at (`pointing`: the Friend's point, or a hint), or null when it stops. The Spine keeps the one
  // dim (78%) for the rest, so a pointed-at thread never dims twice; while the view follows your talk, the target comes
  // into view (a view a hand holds stays where it was left).
  useBrickEvent(on, "pointing", (target) => {
    const thought = target?.thoughtId ? map.thoughts.find((t) => t.id === target.thoughtId) : undefined;
    const thread = target?.threadId ?? thought?.thread_id ?? null;
    setPointing(thread ? { thread } : null);
    const item = thought ? layout.items.find((i) => i.thoughts?.includes(thought.id)) : thread ? layout.byKey.get(`t:${thread}`) : undefined;
    if (item && following && !camera.comfortable(item.box)) camera.aim(item.box, { ring: item.key });
  });

  const seenCues = useCallback((keys: string[]) => setCues((was) => was.filter((cue) => !keys.includes(cue.key))), []);
  const goTo = (cue: Cue) => {
    setCues((was) => was.filter((c) => c.key !== cue.key));
    const item = layout.byKey.get(cue.key);
    if (!item) return;
    stopFollowing();
    camera.aim(item.box, { ring: item.key });
  };

  // A move, at once on screen, then on the map for every window. Offline it can't go: it says so and stays put.
  const put = useCallback((id: string, x: number | null, y: number | null) => {
    if (!map.connected) { actions.notify("Not connected: it stays where it was until this window reconnects."); return false; }
    setPending((was) => ({ ...was, [id]: x === null || y === null ? null : { x, y, by: map.me, at_ms: Date.now() } }));
    actions.position(id, x, y);
    return true;
  }, [actions, map.me, map.connected]);
  const keep = (id: string) => shelf.add(id);

  // Picking words for a margin note: the selection inside the point's words, and "Reply" under its end.
  const unpick = () => { setSelecting(null); setPicking(null); };
  useEffect(() => {
    if (!selecting) return;
    const changed = () => {
      const selection = getSelection();
      const text = frame.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(selecting.key)}"] .spine-text`);
      if (!selection || !selection.rangeCount || selection.isCollapsed || !text || !text.contains(selection.anchorNode) || !text.contains(selection.focusNode)) {
        setPicking((was) => (was?.typing ? was : null));
        return;
      }
      const quote = selection.toString().replace(/\s+/g, " ").trim();
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const frameBox = frame.current!.getBoundingClientRect();
      if (quote) setPicking((was) => (was?.typing ? was : { key: selecting.key, thoughtId: selecting.thoughtId, quote, x: rect.right - frameBox.left - 40, y: rect.bottom - frameBox.top, typing: false }));
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [selecting]);

  const acts = useMemo<Acts>(() => ({
    toggle: (thread) => { stopFollowing(); setOpen((was) => (was?.id === thread ? null : { id: thread, by: "you" })); },
    pick: (item) => { touched.current = Date.now(); setPicked(item.key); actions.select(item.thread); },
    words: (item) => { stopFollowing(); setOriginals((was) => { const next = new Set(was); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); },
    // Reached by Tab: brought into view, as a pointer would have to go there.
    focus: (item) => { if (!onScreen(item, transform(), area()).inside) { stopFollowing(); camera.aim(item.box, { ring: item.key }); } },
    openOnMap: (thread) => actions.openThread(thread),
    shelve: (item) => keep(item.id),
    unpin: (item) => { put(item.id, null, null); },
    select: (item, x, y) => {
      const thoughtId = item.thoughts?.at(-1);
      if (!thoughtId) return;
      camera.hold();
      setSelecting({ key: item.key, thoughtId });
      setPicking(null);
      // Once its words can be picked: the word under the pointer, as a double click picks one.
      requestAnimationFrame(() => {
        const caret = document.caretRangeFromPoint?.(x, y);
        const node = caret?.startContainer;
        if (!caret || !node || node.nodeType !== Node.TEXT_NODE) return;
        const words = node.textContent ?? "";
        let start = caret.startOffset, end = start;
        while (start > 0 && /[\p{L}\p{N}'’-]/u.test(words[start - 1])) start--;
        while (end < words.length && /[\p{L}\p{N}'’-]/u.test(words[end])) end++;
        if (end <= start) return;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      });
    },
    reply: (item, quote) => {
      const frameBox = frame.current?.getBoundingClientRect();
      const element = frame.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(item.key)}"]`)?.getBoundingClientRect();
      if (!frameBox || !element) return;
      if (item.kind === "margin") {
        const note = notes.margins.find((m) => m.id === item.margin);
        if (!note) return;
        setSelecting(null);
        setPicking({ key: item.key, thoughtId: note.thoughtId, quote: note.quote, x: element.left - frameBox.left, y: element.bottom - frameBox.top, typing: true });
        return;
      }
      const thoughtId = item.thoughts?.at(-1);
      if (!thoughtId) return;
      camera.hold();
      setPicking({ key: item.key, thoughtId, quote: quote ?? item.text ?? "", x: element.left - frameBox.left + G.textX, y: element.top - frameBox.top + (item.lines?.length ?? 1) * (item.look?.line ?? G.pointLine), typing: true });
    },
    unfold: (margin) => setOpened((was) => { const next = new Set(was); if (next.has(margin)) next.delete(margin); else next.add(margin); return next; }),
    topics: topicNames,
    renameTopic: (from, to) => { actions.renameTopic(from, to); },
    moveToTopic: (thread, topic) => { if (actions.moveToTopic(thread, topic)) setMoving((was) => ({ ...was, [thread]: topic })); },
  }), [actions, put, shelf.items, notes.margins, layout, area, topicNames]);

  // One dim (78%): what isn't the topic you're on while the view follows your talk, or what the Friend isn't pointing at.
  const focusTopic = pointing ? null : following && here && new Set(layout.items.map((item) => item.topic)).size > 1 ? here.topic : null;
  const datas = useMemo(() => new Map(layout.items.map((item): [string, ItemData] => [item.key, {
    item, here: item.key === hereKey, pulse: pulses[item.key] ?? 0, fresh: fresh.has(item.key), picked: picked === item.key,
    // A topic's header is where things are, never dimmed.
    dim: item.kind === "group" ? false : pointing ? item.thread !== pointing.thread : !!focusTopic && item.topic !== focusTopic,
    hot: item.kind === "group" && !!dropTo && item.group === dropTo,
    // A closed card is the slot of the tangent you're on (its points are folded inside it).
    arriving: arriving && item.thoughts?.includes(arriving) ? arriving
      : item.kind === "card" && !item.open && item.thread === map.active && slots.length ? slots[0] : null,
    cut: camera.cut === item.key, selecting: selecting?.key === item.key,
  }])), [layout, hereKey, pulses, fresh, picked, focusTopic, pointing, arriving, camera.cut, selecting, map.active, slotKey, dropTo]);
  const nodes: ItemNode[] = layout.items.map((item) => ({
    // Its size is known before it's drawn (layout.ts): said as measured, the canvas never measures it again (a node
    // without it is measured on every update, and a moving canvas would loop the browser's resize observer).
    id: item.key, type: "item", className: "spine-node", position: at(item), data: datas.get(item.key)!, width: item.box.w, height: item.box.h, measured: { width: item.box.w, height: item.box.h },
    draggable: item.kind !== "notch" && item.kind !== "slot" && item.kind !== "margin" && item.kind !== "group", selectable: false, focusable: false, connectable: false,
    // Heads over points: far out, a topic's title covers the top of its own spine (in reach of a point, never at it).
    zIndex: (item.kind === "notch" || item.kind === "slot" || item.kind === "group" ? 0 : item.kind === "card" ? 1 : item.kind === "point" || item.kind === "aside" ? (item.look?.variant === "mini" ? 3 : 2) : item.kind === "margin" ? 3 : 4)
      + (item.pinned ? 5 : 0) + (group?.has(item.key) ? 20 : 0),
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
  /** The named topic whose columns a carried spine is over (anywhere over its header or its columns, a little past
   *  either end), when it isn't the spine's own: dropped there, the spine goes under it. Only a spine laid out by topic,
   *  and only while two or more topics are named. */
  const topicUnder = (event: MouseEvent | TouchEvent, item: Item | undefined) => {
    if (!item || item.kind !== "head" || layout.groups.length < 2) return null;
    const { clientX, clientY } = pointer(event);
    const at = flow.screenToFlowPosition({ x: clientX, y: clientY });
    const over = layout.groups.find(({ box }) => at.x >= box.x - G.laneGap / 2 && at.x <= box.x + box.w + G.laneGap / 2
      && at.y >= box.y - G.groupGap * 3 && at.y <= box.y + box.h + G.rowGap * 3);
    return over && over.name && over.name !== item.group ? over.name : null;
  };
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
    // Pictures shows no words for a tangent's curve to leave from the end of: it leaves the line (the point's dot, or the
    // topic's picture) instead.
    const dx = shownStop === "pictures" && link.kind === "branch" && end === link.from ? G.lineX : end.dx;
    return { x: p.x + dx, y: p.y + end.dy };
  };

  // The zoom stops: one place at three distances. Words is reading size at what you follow (or the middle of the view);
  // Titles keeps the name's usual three-line measure at 13 px; larger maps need panning.
  // Pictures fits the whole map, a little further out.
  const farOut = useStore((s) => s.transform[2] < READ);
  const shownStop: Stop = farOut ? (stop === "words" ? "titles" : stop) : "words";
  const choose = (next: Stop) => {
    setStop(next);
    if (next === "words") {
      const g = following ? goal() : null;
      const target = g?.box ?? middle()?.box;
      if (target) camera.aim(target, { zoom: 1, ring: g?.ring });
      return;
    }
    stopFollowing();
    // The usual title measure, resized from 18 px to 13 px, plus the label's 6 px padding.
    const titleZoom = (G.titleW * 13 / 18 + 2 * 6) / G.colW;
    camera.fit(all(), next === "titles" ? 0.6 : 0.42, next === "titles" ? Math.max(minZoom, titleZoom) : minZoom);
  };
  const seeAll = () => { stopFollowing(); camera.fit(all(), 1, minZoom); };

  // Keys, from anywhere on the page but a field or a dialog: 1 2 3 the stops, 0 everything, F follow, N the newest edge
  // chip, S the shelf, + and − zoom. Picking words: Enter answers them, Esc lets them go.
  const keyed = useRef<(event: KeyboardEvent) => void>(() => {});
  keyed.current = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const target = event.target as Element | null;
    if (target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']") || document.querySelector("dialog[open]")) return;
    if (selecting || picking) {
      if (event.key === "Escape") { event.preventDefault(); unpick(); getSelection()?.removeAllRanges(); return; }
      if (event.key === "Enter" && picking && !picking.typing) { event.preventDefault(); setPicking({ ...picking, typing: true }); return; }
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "1") choose("words");
    else if (key === "2") choose("titles");
    else if (key === "3") choose("pictures");
    else if (key === "0") seeAll();
    else if (key === "f") { if (following) stopFollowing(); else startFollowing(); }
    else if (key === "n" && cues.length) goTo([...cues].sort((a, b) => b.at - a.at)[0]);
    else if (key === "s" && layout.shelf.length) setShelfOpen((was) => !was);
    else if (key === "+" || key === "=") { stopFollowing(); void flow.zoomIn({ duration: reduced ? 0 : 200 }); }
    else if (key === "-") { stopFollowing(); void flow.zoomOut({ duration: reduced ? 0 : 200 }); }
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => keyed.current(event);
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);

  const ready_ = ready && top !== null;
  const rowStyle = { bottom: corner.row };
  return <div className="spine">
    <div ref={anchor} className="spine-anchor" style={{ height: box?.tall ?? 0 }} />
    <div ref={frame} className={cls("spine-frame", ready_ && "spine-ready", shownStop === "pictures" && "spine-stop-pictures", narrow && "spine-narrow")} style={{ top: top ?? 0, left: box?.left ?? 0, right: box?.right ?? 0 }}>
      <ActsContext.Provider value={acts}>
      <NowContext.Provider value={now}>
      <ReactFlow<ItemNode>
        className="spine-flow" nodes={nodes} edges={[]} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange}
        onNodeDragStart={() => { stopFollowing(); unpick(); }}
        onNodeDrag={(event, node) => {
          const shelfHot = overShelfAt(event);
          setOverShelf(shelfHot);
          const to = shelfHot ? null : topicUnder(event, layout.byKey.get(node.id));
          setDropTo((was) => (was === to ? was : to));
        }}
        onNodeDragStop={(event, node) => {
          const item = layout.byKey.get(node.id);
          const was = grip.current;
          grip.current = null;
          setDrag(null);
          setOverShelf(false);
          setDropTo(null);
          if (!item) return;
          const to = overShelfAt(event) ? null : topicUnder(event, item);
          // Onto the shelf: kept there, and its place on the canvas is what it was before the drag.
          if (overShelfAt(event)) {
            keep(item.id);
            if (was?.id === item.id) put(item.id, was.was?.x ?? null, was.was?.y ?? null);
          } else if (to) {
            // Onto another topic's columns: it goes under that topic, laid out there with the rest (placed by hand before,
            // it's laid out now: that's where it was dropped).
            put(item.id, null, null);
            acts.moveToTopic(item.thread, to);
          } else put(item.id, node.position.x, node.position.y);
        }}
        onMoveStart={(event) => { if (event) { setHandMoving(true); stopFollowing(); if (!picking?.typing) unpick(); } }}
        onMove={(event) => { if (event) touched.current = Date.now(); }}
        onMoveEnd={(event) => { if (event) { setHandMoving(false); touch(); } }}
        onPaneClick={() => { setPicked(null); if (!picking?.typing) unpick(); }}
        minZoom={minZoom} maxZoom={2} nodeDragThreshold={DRAG}
        panOnScroll zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} elementsSelectable={false}
        nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} proOptions={{ hideAttribution: true }}
        aria-label="Your topics on the canvas: drag the canvas to look around, pinch or Ctrl and scroll to zoom; 1, 2 and 3 for words, titles and pictures">
        <Background className="spine-grid" variant={BackgroundVariant.Dots} gap={28} size={1.2} />
        <ZoomVar />
        <EdgeLabelRenderer>
          <svg className="spine-links" aria-hidden="true">
            {layout.links.map((link) => {
              const d = pathOf(link, linkEnd(link));
              const drawn = fresh.has(link.key) && link.kind !== "pulled" && link.kind !== "slot";
              const dim = pointing ? !!link.topic && layout.byKey.get(link.to.key)?.thread !== pointing.thread : !!focusTopic && link.topic !== focusTopic;
              const start = link.kind === "branch" || link.kind === "note" ? linkEnd(link)(link.from) : null;
              return d && <g key={link.key} className={cls(dim && "spine-link-dim")}>
                <path d={d} className={cls("spine-link", LINK_CLASS[link.kind], drawn && "spine-draw")}
                  pathLength={drawn ? 1 : undefined} style={{ stroke: link.room && link.kind !== "note" ? `var(--room-${link.room})` : undefined }} />
                {start && <circle className={cls("spine-link-end", link.kind === "note" && "spine-link-end-note")} cx={start.x} cy={start.y} r={2.2}
                  style={{ fill: link.room && link.kind !== "note" ? `var(--room-${link.room})` : undefined }} />}
              </g>;
            })}
          </svg>
        </EdgeLabelRenderer>
      </ReactFlow>
      {!narrow && <Cues cues={cues} layout={layout} area={area} avoid={avoid} width={width} narrow={false} go={goTo} seen={seenCues} />}
      </NowContext.Provider>
      </ActsContext.Provider>
      {picking && <Reply key={`${picking.key}|${picking.quote}`} picking={picking} width={width} start={() => setPicking({ ...picking, typing: true })} cancel={() => { unpick(); getSelection()?.removeAllRanges(); }}
        send={(text) => { notes.add(picking.thoughtId, picking.quote, text); unpick(); getSelection()?.removeAllRanges(); }} />}
      {/* The camera's corner: bottom left in the shell that has a stage (its regions); in the app without one, over the
          shelf at the right, where the left is the notice timeline's. */}
      {!narrow && corner.shell && <div className="spine-corner spine-corner-left" style={{ bottom: corner.bottom }}>
        <Corner following={following} title={activeThread?.title ?? ""} stop={shownStop} narrow={false} follow={() => (following ? stopFollowing() : startFollowing())} seeAll={seeAll} choose={choose} />
      </div>}
      <div className={cls("spine-corner", narrow ? "spine-corner-row" : "spine-corner-right")} style={narrow ? rowStyle : { bottom: corner.bottomRight }}>
        {narrow && <Cues cues={cues} layout={layout} area={area} avoid={avoid} width={width} narrow go={goTo} seen={seenCues} />}
        {(narrow || !corner.shell) && <Corner following={following} title={activeThread?.title ?? ""} stop={shownStop} narrow={narrow} follow={() => (following ? stopFollowing() : startFollowing())} seeAll={seeAll} choose={choose} />}
        <Shelf ref={shelfRef} entries={layout.shelf} carrying={!!drag} hot={overShelf} open={shelfOpen} setOpen={setShelfOpen} narrow={narrow}
          putBack={(id) => shelf.remove(id)}
          place={(id, x, y) => {
            const frameBox = frame.current?.getBoundingClientRect();
            const p = flow.screenToFlowPosition({ x, y });
            if (frameBox && y < frameBox.top + area().y1 && put(id, p.x - G.lineX, p.y - G.dotY)) shelf.remove(id);
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
