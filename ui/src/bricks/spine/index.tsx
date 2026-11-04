import { CaptureAccess, CaptureContext, CaptureView, useCaptureNodes } from "./capture";
import { codePointOffset } from "../contract";
import { usePluginState, useBuiltInsOn } from "../contract";
// The Spine: the map as one canvas you can pan and zoom without end. Each topic is a spine of its points, oldest at
// the top; each tangent hangs beside the point it came from (layout.ts). The camera follows what you're talking about
// and lets go the moment a hand moves the map (camera.ts). Your thought on its way has a dashed slot where it's
// expected (`data-slot="slot:<thought id>"`, what the bubble flight aims at); the newest landing rings once and says what
// put it there and how fast; what lands out of view gets an edge chip until you've seen it (cues.tsx). Words in a point
// can be answered in a margin note (margin.tsx). Anything can be dragged where you want it and stays there
// (map.positions), and the shelf keeps things at hand while the canvas moves. A view brick (docs/bricks.md): its name
// joins Map and Palace.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, EdgeLabelRenderer, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useStoreApi, type NodeChange, type NodeProps } from "@xyflow/react";
import pluginStyle0 from "@xyflow/react/dist/base.css?inline";
import { useBrickEvent, CanvasToolsContext, SemanticZoomContext, ShapesContext, type BrickEvents, type BrickProps, type Position } from "../contract";
import { useCamera, type Area } from "./camera";
import { Terse } from "./terse";
import { FILM, filmHeld } from "./film";
import { Corner, type Stop } from "./corner";
import { Cues, onScreen, type Cue } from "./cues";
import { bounds, phoneParents, G, layout as place, type Box, type End, type Item, type Layout, type Link } from "./layout";
import { Reply, useMargins, type Picking } from "./margin";
import { ActsContext, ItemView, NowContext, READ, type Acts, type ItemData, type ItemNode } from "./nodes";
import { Shelf } from "./shelf";
import { PhoneOverview } from "./overview";
import { useStayingHere } from "../../StayHere";
import { C, CONVERSATION } from "./conversation";
import { lensLayout, shiftLayout, type Lens } from "./lenses";
import pluginStyle1 from "./spine.css?inline";
import { useThreadReveal } from "./thread-reveal";
import { looseThread } from "./loose-topics";
import looseTopicStyles from "./loose-topics.css?inline";
import { InlinePhone } from "./InlinePhone";
import { phoneUsableArea } from "./measure";
import { CanvasToolNode, CanvasToolControls, useCanvasToolNodes, type CanvasNode } from "./canvas-tools";
import { PhoneNavigation } from "./phone";
import { semanticBlend } from "./semantic-zoom";
import { CanvasShapes } from "./shapes";
import { anchorAt, normalAngle, rotatePoint, screenToWorld, turnAt, worldToScreen, type Camera } from "./rotation";

/** A press that moves less than this is a click, not a drag: a hand's wobble on a click is 1–3 px. */
const DRAG = 4;
/** Things making room glide this long (Material's standard duration for elements moving on screen, 300 ms); under
 *  Reduce Motion they cross-fade in half that. */
const GLIDE_MS = 300;
const FADE_MS = 150;
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
  const capture = useContext(CaptureContext);
  const shapes = useContext(ShapesContext);
  const tools = useContext(CanvasToolsContext);
  // Canvas tools need the flow surface; the selected Terse view returns when tools exit.
  if (props.map.terse && !FILM && !tools) return <Terse {...props} />;
  const conversation = !!props.map.conversationSpine;
  if (!capture && !tools && !props.map.threads.length && !(conversation && props.map.thoughts.length) && !shapes?.enabled) return <p className="spine-empty">Nothing on the map yet. Say or type a thought, and its topic starts here.</p>;
  return <ReactFlowProvider key={String(conversation)}><Canvas {...props} conversation={conversation} /></ReactFlowProvider>;
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
function useGlide(layout: Layout, reduced: boolean, seeds: Map<string, Box>, held: Map<string, { x: number; y: number }> | null, fadeIn: (keys: string[]) => void) {
  const shown = useRef(new Map<string, { x: number; y: number }>());
  const [, tick] = useState(0);
  for (const [key, box] of seeds) if (!shown.current.has(key)) shown.current.set(key, { x: box.x, y: box.y });
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
  const [held, setHeld] = usePluginState("shelf", () => ({ key, items: read(key) }));
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

/** Actual placement data for the optional Details disclosure; confirmation stays separate. */
export function landingNote(model: string | undefined, ms: number | null | undefined) {
  // "muse-spark-1.3-contributor" → "Muse Spark 1.3": the public name (contributor mode is how the key asks, not a model).
  const name = model ? (model.includes(" ") ? model : model.split("-").filter((part) => part && part !== "contributor")
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1))).join(" ")) : "";
  const time = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? `${(ms / 1000).toFixed(1)} s` : "";
  return [time ? `Placement: ${time}` : "", name ? `Model: ${name}` : ""].filter(Boolean).join(" · ") || "No placement details were reported.";
}

/** What floats over the canvas at its edges: the shell's four corners (their slots), the Talk pill under Find and
 *  Catalog, the guide's held questions, and the canvas's own corners. */
const COVERS = '[data-slot="top-left"], [data-slot="top-right"], [data-slot="bottom-left"], [data-slot="bottom-right"], [data-slot="held"], .talk-pill, .guide-held, .spine-corner, .spine-rotation';

/** The page's slots (contract.ts `SlotName`), measured: where the stage starts, how tall the status line is. */
function chromeOf(frameBox: DOMRect | undefined) {
  const stage = document.querySelector('[data-slot="stage"]')?.getBoundingClientRect();
  const status = document.querySelector('[data-slot="status"]')?.getBoundingClientRect();
  // An empty stage still belongs to the shell: its input now lives in the bottom bar. Keep the camera and shelf in
  // their separate corners, rather than crowding both into the classic page's right corner and taking chips' slots.
  return { stage: stage && stage.width ? stage : null, status: status?.height ?? 0, frame: frameBox };
}

function Canvas({ map, actions, on, destination, conversation: conversationEnabled, state }: BrickProps & { conversation: boolean }) {
  const parts = useBuiltInsOn();
  const capture = useContext(CaptureContext);
  // A hidden, retained Canvas keeps its ordering while its input temporarily belongs to another view.
  const captureLayout = useRef(!!capture);
  if (capture) captureLayout.current = true;
  const readingOrder = captureLayout.current;
  const flow = useReactFlow<ItemNode>();
  const tools = useContext(CanvasToolsContext);
  const [lens, setLens] = useState<{ view: Lens; x: number; y: number }>(() => {
    let view: Lens = "time";
    try { if (localStorage.getItem("e2a2o.spine.lens") === "topics") view = "topics"; } catch { /* this visit */ }
    return { view, x: 0, y: 0 };
  });
  const loose = !!map.looseTopics && !conversationEnabled;
  const rotationOn = !!map.rotateCanvas;
  const [localAngle, setLocalAngle] = useState(0);
  const angleRef = useRef(0);
  const angle = rotationOn ? localAngle : 0;
  const hasViewport = useRef(!!state?.get("viewport")).current;
  const [viewport, setViewport] = usePluginState("viewport", { x: 0, y: 0, zoom: 1 });
  useLayoutEffect(() => { if (state && !hasViewport) setViewport(flow.getViewport()); }, [state]);
  const semantic = useContext(SemanticZoomContext);
  const staying = useStayingHere();
  const reduced = useReducedMotion();
  const shelf = useShelf(map);
  const notes = useMargins(map, actions);
  const frame = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const rotationControls = useCallback((element: HTMLDivElement | null) => {
    if (!element && controlsRef.current?.contains(document.activeElement)) frame.current?.focus({ preventScroll: true });
    controlsRef.current = element;
  }, []);
  const anchor = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(0);
  const [corner, setCorner] = useState({ bottom: 12, bottomRight: 12, row: 12, shell: false });
  const [open, setOpen] = usePluginState<{ id: string; by: "follow" | "you" } | null>("open-point", null);
  const [following, setFollowing] = usePluginState('spine/index.tsx:following', true);
  const [originals, setOriginals] = usePluginState<ReadonlySet<string>>('spine/index.tsx:originals', new Set());
  const [picked, setPicked] = usePluginState<string | null>('spine/index.tsx:picked', null);
  const [pending, setPending] = useState<Record<string, Position | null>>({});
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  // While a hand holds something, the map's echoes of its own steps don't move it under the hand: it stays where it was
  // when the drag began (`grip`), and lands where it's dropped.
  const grip = useRef<{ id: string; was: Position | undefined } | null>(null);
  const [overShelf, setOverShelf] = useState(false);
  const [shelfOpen, setShelfOpen] = usePluginState('spine/index.tsx:shelfOpen', false);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [cues, setCues] = useState<Cue[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const [stop, setStop] = usePluginState<Stop>('spine/index.tsx:stop', "words");
  const [landing, setLanding] = useState<{ thought: string; text: string } | null>(null);
  const [arriving, setArriving] = useState<string | null>(null);
  const [opened, setOpened] = usePluginState<ReadonlySet<string>>('spine/index.tsx:opened', new Set());
  const [selecting, setSelecting] = useState<{ key: string; thoughtId: string } | null>(null);
  const [picking, setPicking] = usePluginState<Picking | null>('spine/index.tsx:picking', null);
  const [pointing, setPointing] = useState<{ thread: string } | null>(null);
  // A spine moved under another topic, shown there at once until the map says so (a refused move lets go).
  const [moving, setMoving] = useState<Record<string, string>>({});
  // The named topic a carried spine is over, while it's carried: dropped, it goes under it.
  const [dropTo, setDropTo] = useState<string | null>(null);
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
      // A retained view can sit inside a display:contents wrapper, which has no layout box.
      // Measure the containing box, just as when main is a direct child of the app.
      let container = here.closest("main")?.parentElement;
      while (container && getComputedStyle(container).display === "contents") container = container.parentElement;
      const room = container?.getBoundingClientRect();
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
        ? (chrome.stage.left - next.left >= (conversation ? 600 : CORNER_W) ? chrome.status + 12 : bottomEdge - chrome.stage.top + 8)
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
  const compare = !!map.comparePhoneReading && (box?.width ?? innerWidth) <= 600;
  const conversation = conversationEnabled && !compare;
  const [readingMode, setReadingMode] = useState<"spatial" | "inline">("spatial");
  // Canvas tools own the shell bodies; Inline restores their ordinary shell before hiding the spatial surface.
  const inline = compare && readingMode === "inline" && !tools;
  const [inspected, setInspected] = useState<string | null>(null);
  const [phoneArea, setPhoneArea] = useState<Area>({ x0: 0, y0: 80, x1: width, y1: 500 });
  const [textScale, setTextScale] = useState(1);
  const phoneControls = useRef<HTMLDivElement>(null);
  const parents = useMemo(() => compare ? phoneParents(map.threads, map.thoughts) : new Map(), [compare, map.threads, map.thoughts]);
  useLayoutEffect(() => {
    if (!compare) { setReadingMode("spatial"); setInspected(null); return; }
    const measure = () => {
      const a = phoneUsableArea(frame.current, dock);
      setPhoneArea(was => Object.keys(a).every(k => a[k as keyof Area] === was[k as keyof Area]) ? was : a);
      setTextScale((parseFloat(getComputedStyle(document.body).fontSize) || 15) / 15);
    };
    measure();
    const resize = new ResizeObserver(measure);
    const styles = new MutationObserver(measure);
    styles.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    document.querySelectorAll('.phone-controls, .spine-corner, [data-slot], .shell-composer, body').forEach(e => resize.observe(e));
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => { resize.disconnect(); styles.disconnect(); window.visualViewport?.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [compare, dock, top, inline]);
  const inspect = (threadId: string, thoughtId: string | null) => {
    if (!compare) return;
    setInspected(threadId);
    actions.openPoint(threadId, thoughtId);
  };
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
    if (compare) return phoneUsableArea(frame.current, dock);
    const frameBox = frame.current?.getBoundingClientRect();
    const w = frameBox?.width ?? innerWidth, h = frameBox?.height ?? innerHeight;
    const chrome = chromeOf(frameBox);
    // The rail (`data-slot="rail"`, the panel at the right) once the page has one: the camera keeps clear of it.
    const rail = document.querySelector('[data-slot="rail"]')?.getBoundingClientRect();
    // The shell's top buttons and Talk pill float over the map. Leave their measured band clear, just as we do the input.
    const topCovers = [...document.querySelectorAll('[data-slot="top-left"], [data-slot="top-right"], .talk-pill, .spine-rotation' + (!conversation ? ', .sample-recovery-actions' : ''))]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
    const y0 = Math.max(0, ...topCovers.map((r) => r.bottom - (frameBox?.top ?? 0) + 8));
    const controlBand = !conversation && document.documentElement.classList.contains("shell2")
      ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--shell-content-bottom")) || 0 : 0;
    const y1 = Math.min(h - controlBand, chrome.stage?.height ? chrome.stage.top - (frameBox?.top ?? 0) - 8 : h - dock);
    const x1 = rail && rail.width && rail.left > (frameBox?.left ?? 0) + w / 2 ? rail.left - (frameBox?.left ?? 0) - 8 : w;
    return { x0: 0, y0, x1: Math.max(160, x1), y1: Math.max(y0 + 120, y1) };
  }, [dock, compare, conversation]);

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
  const slots = useMemo(() => capture ? [] : map.thoughts.filter((t) => !t.placed && !t.thread_id && t.speaker === map.me).slice(-SLOTS_MAX).map((t) => t.id), [map.thoughts, map.me, !!capture]);
  const slotKey = slots.join("|");
  const threads = useMemo(() => {
    const shown = !compare && notes.anchored.size ? map.threads.filter((t) => !notes.anchored.has(t.id)) : map.threads;
    return Object.keys(moving).length ? shown.map((t) => (moving[t.id] && t.topic !== moving[t.id] ? { ...t, topic: moving[t.id] } : t)) : shown;
  }, [map.threads, notes.anchored, moving, compare]);
  const topicNames = useMemo(() => map.topics.map((topic) => topic.name), [map.topics]);
  const pauses = useMemo(() => (map.pauses??[]).filter(p=>p.speaker===map.me&&!p.resolved),[map.pauses,map.me]);
  const pauseCounts = useMemo(()=>{const counts=new Map<string,number>();for(const pause of pauses)counts.set(pause.thought_id,(counts.get(pause.thought_id)??0)+1);return counts;},[pauses]);
  const layoutInput = useMemo(() => ({ threads: conversation ? map.threads : threads, thoughts: map.thoughts, notes: map.notes, rooms: map.rooms, positions, shelf: shelf.items, open: open?.id ?? null,
    quietSolo: parts.has("quiet-solo-attribution"), readingOrder, looseTopics: loose, me: map.me, speakers: map.speakers, active: staying ?? map.active, slots, paused: pauseCounts, landing, margins: compare ? [] : notes.margins, opened, narrow, topics: topicNames, staying, originals, comparePhone: compare, textScale }),
  [parts, loose, readingOrder, compare, textScale, pauseCounts, conversation, map.threads, threads, map.thoughts, map.notes, map.rooms, positions, shelf.items, open?.id, map.me, map.speakers, map.active, slotKey, landing, notes.margins, opened, narrow, topicNames, staying, originals]);
  const layout = useMemo(() => conversation && !compare ? shiftLayout(lensLayout(layoutInput, lens.view), lens) : place(layoutInput), [conversation, layoutInput, lens]);
  const threadReveal = useThreadReveal(layout, loose);
  const captureNodes = useCaptureNodes(layout, map);
  // A move the map now shows, or one that never came (refused, or the core away), stops being held.
  useEffect(() => {
    const ids = Object.keys(moving);
    if (!ids.length) return;
    const there = ids.filter((id) => map.threads.find((t) => t.id === id)?.topic === moving[id]);
    if (there.length) setMoving((was) => Object.fromEntries(Object.entries(was).filter(([id]) => !there.includes(id))));
    const timer = window.setTimeout(() => setMoving({}), 4000);
    return () => window.clearTimeout(timer);
  }, [map.threads, moving]);
  const hereKey = conversation ? layout.tips.get(CONVERSATION) : staying || map.active ? layout.tips.get((staying ?? map.active)!) : undefined;
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
  const shown = useGlide(layout, reduced || compare, captureNodes.seeds, held, keys => { if (!compare) fadeIn(keys); });
  const at = (item: Item) => held?.get(item.key) ?? shown.get(item.key) ?? item.box;

  // The camera.
  const pane = useCallback(() => frame.current?.querySelector<HTMLElement>(".spine-flow") ?? null, []);
  const readingZoom = loose ? Math.max(1, Math.min(3, window.innerWidth / 1280)) : new URLSearchParams(location.search).has("rehearse") ? Math.min(2, Math.max(1, window.innerWidth / 1920)) : 1;
  const camera = useCamera(flow, area, reduced || compare, pane, (key) => layout.byKey.get(key)?.box, angle, !inline, true, readingZoom);
  const savedCamera = useRef<ReturnType<typeof flow.getViewport> | null>(null);
  const wasInline = useRef(false);
  useLayoutEffect(() => {
    if (inline && !wasInline.current) { savedCamera.current = flow.getViewport(); camera.hold(); }
    if (!inline && wasInline.current && savedCamera.current) {
      void flow.setViewport(savedCamera.current, { duration: 0 });
      reached.current = destination; // Returning to A keeps its camera, including zoom.
    }
    wasInline.current = inline;
  }, [inline]);
  const all = () => bounds([...layout.items.map((item) => item.box), ...(captureNodes.box ? [captureNodes.box] : [])]);
  const minZoom = useMemo(() => {
    const everything = all();
    const a = area();
    return Math.max(0.04, Math.min(0.5, 0.8 * Math.min((a.x1 - a.x0 - 64) / Math.max(everything.w, 1), (a.y1 - a.y0 - 64) / Math.max(everything.h, 1))));
  }, [layout, dock, top, area, width, box?.tall]);
  /** What the follow keeps in view: your latest point, with the slots under it. */
  const goal = () => {
    if (captureNodes.box) {
      const free = area();
      return { box: captureNodes.box.h <= free.y1 - free.y0 - 32 ? captureNodes.box : captureNodes.activeBox!, ring: "capture:active" };
    }
    if (!here) return null;
    const boxes = [here.box, ...slotsHere.map((key) => layout.byKey.get(key)?.box).filter((b): b is Box => !!b)];
    // Keep the theme heading above this landing visible when the available height permits it.
    const group = layout.byKey.get(`t:${here.topic}`)?.group;
    const heading = group && layout.byKey.get(`g:${group}`);
    if (heading) boxes.push({ ...here.box, y: heading.box.y, h: heading.box.h });
    if (staying) boxes.push(...layout.items.filter((item) => item.kind === "margin" && item.up === here.key).map((item) => item.box));
    const target = bounds(boxes);
    // A side lane must not hide another column when both columns fit at reading size.
    const whole = all(), free = area();
    if (box?.right && whole.w + 64 <= free.x1 - free.x0) {
      target.x = whole.x;
      target.w = whole.w;
    }
    return { box: target, ring: here.key };
  };
  const goalNow = useRef(goal);
  // Words being picked or answered keep the view where it is.
  goalNow.current = () => (following && !drag && !selecting && !picking ? goal() : null);
  const followBox = goal()?.box;

  // Opening: your latest point at reading size, or the whole map when you're nowhere yet; shown once it's there.
  useEffect(() => {
    if (ready || top === null) return;
    const g = goal();
    if (hasViewport) void flow.setViewport(viewport);
    else {
      const opening = !capture && narrow && !conversation && document.documentElement.classList.contains("shell2")
        ? layout.items.find(item => item.kind === "head" && item.thread === here?.thread) : undefined;
      if (capture && !map.threads.length && captureNodes.box) {
        const free = area();
        void flow.setViewport({ x: (narrow ? Math.min(28, Math.max(10, (width - 300) / 2)) : 96) - captureNodes.box.x, y: free.y0 + (narrow ? 32 : 64) - captureNodes.box.y, zoom: 1 }, { duration: 0 });
      } else if (opening) camera.aim(opening.box, { zoom: readingZoom, instant: true, alignTop: true });
      else if (g) camera.aim(g.box, { zoom: readingZoom, instant: true }); else camera.fit(all(), readingZoom, minZoom, { instant: true });
    }
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
    if (filmHeld()) return;
    if (!ready) return;
    if (!following && previous) {
      const view = flow.getViewport();
      const zoom = new URLSearchParams(location.search).has("rehearse") ? readingZoom : view.zoom;
      const scale = zoom / view.zoom;
      void flow.setViewport({ x: width / 2 - (previous.width / 2 - view.x) * scale, y: box.tall / 2 - (previous.height / 2 - view.y) * scale, zoom }, { duration: 0 });
      return;
    }
    const g = goal();
    if (box.right > 0) camera.fit(all(), readingZoom, minZoom, { instant: true });
    else if (g) camera.aim(g.box, { zoom: readingZoom, instant: true }); else camera.fit(all(), readingZoom, minZoom, { instant: true });
  }, [width, box?.tall]);
  // Following: where you are stays in view as you talk (the camera spaces and limits the moves).
  // The canvas itself getting wider or narrower (a lane taking the page's right side, or giving it back) is a reason to
  // look again: what you're on may no longer be in the comfortable middle.
  useEffect(() => {
    if (!inline && ready && following && (here || (capture && map.thoughts.length)) && !drag) camera.follow(() => goalNow.current());
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
    if (inline || !ready || !destination || reached.current === destination) return;
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
    if (point && !compare && !originals.has(point.id)) {
      setOriginals((was) => new Set([...was, point.id]));
      return; // Aim after the original words have their measured space.
    }
    reached.current = destination;
    camera.aim(item.box, { ring: item.key, instant: compare });
    if (compare) requestAnimationFrame(() => frame.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(item.key)}"] .spine-text, [data-id="${CSS.escape(item.key)}"] .spine-title`)?.focus({ preventScroll: true }));
  }, [inline, ready, destination, layout, map.threads, open?.id, originals, camera.aim]);

  const stopFollowing = () => { setFollowing(false); camera.hold(); };
  const switchLens = (view: Lens) => {
    if (view === lens.view) return;
    stopFollowing();
    const next = lensLayout(layoutInput, view);
    const viewport = flow.getViewport();
    const a = area();
    const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
    const focused = document.activeElement?.closest<HTMLElement>("[data-thought]")?.dataset.thought;
    const cards = layout.items.filter(item => item.kind === "point" && next.byKey.has(item.key));
    const distance = (item: Item) => { const p = at(item); const screen = worldToScreen({ x: p.x + G.textX, y: p.y + C.speaker }, { ...viewport, angle }); return Math.hypot(screen.x - cx, screen.y - cy); };
    const watched = cards.find(item => item.id === focused) ?? cards.sort((a, b) => distance(a) - distance(b))[0];
    const old = watched ? at(watched) : { x: 0, y: 0 };
    const target = watched ? next.byKey.get(watched.key)!.box : { x: 0, y: 0 };
    const apply = () => setLens({ view, x: old.x - target.x, y: old.y - target.y });
    const element = pane();
    if (reduced && element) {
      const fade = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS / 2, fill: "forwards" });
      fade.onfinish = () => {
        apply();
        requestAnimationFrame(() => {
          fade.cancel();
          element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS / 2 });
        });
      };
    } else apply();
    try { localStorage.setItem("e2a2o.spine.lens", view); } catch { /* this visit */ }
  };
  // The angle belongs to this mounted camera only. Reset/off keep the same world point in the free area's center.
  const turnTo = (degrees: number) => {
    if (!Number.isFinite(degrees)) return;
    stopFollowing();
    const a = area(), next = normalAngle(degrees);
    void flow.setViewport(turnAt({ ...flow.getViewport(), angle: angleRef.current }, next,
      { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 }), { duration: 0 });
    angleRef.current = next;
    setLocalAngle(next);
  };
  useLayoutEffect(() => { if (!rotationOn && angleRef.current !== 0) turnTo(0); }, [rotationOn]);

  // Safari's GestureEvent exposes an actual rotation (degrees) and cumulative pinch scale. Wheel input remains
  // React Flow's pan/zoom input; Ctrl-wheel is never treated as physical rotation. No gesture listeners when off.
  useEffect(() => {
    if (!rotationOn || inline) return;
    const element = pane();
    if (!element) return;
    type Gesture = Event & { rotation: number; scale: number; clientX: number; clientY: number };
    let gesture: { view: Camera; anchor: { x: number; y: number }; rotation: number; scale: number } | null = null;
    const centroid = (e: Gesture) => {
      const rect = element.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const valid = (e: Gesture) => [e.rotation, e.scale, e.clientX, e.clientY].every(Number.isFinite) && e.scale > 0;
    const start = (event: Event) => {
      const e = event as Gesture;
      if (!valid(e)) return;
      e.preventDefault(); e.stopPropagation();
      setFollowing(false); camera.hold();
      const view = { ...flow.getViewport(), angle: angleRef.current };
      gesture = { view, anchor: screenToWorld(centroid(e), view), rotation: e.rotation, scale: e.scale };
    };
    const change = (event: Event) => {
      const e = event as Gesture;
      if (!gesture || !valid(e)) return;
      e.preventDefault(); e.stopPropagation();
      const next = normalAngle(gesture.view.angle! + e.rotation - gesture.rotation);
      const zoom = Math.max(minZoom, Math.min(2, gesture.view.zoom * e.scale / gesture.scale));
      void flow.setViewport(anchorAt(gesture.anchor, centroid(e), zoom, next), { duration: 0 });
      angleRef.current = next; setLocalAngle(next);
    };
    const end = (event: Event) => { if (gesture) { event.preventDefault(); event.stopPropagation(); } gesture = null; };
    // A browser may emit wheel events alongside its gesture stream: don't zoom twice.
    const wheel = (event: WheelEvent) => { if (gesture) { event.preventDefault(); event.stopPropagation(); } };
    const options = { capture: true, passive: false };
    element.addEventListener("gesturestart", start, options);
    element.addEventListener("gesturechange", change, options);
    element.addEventListener("gestureend", end, options);
    element.addEventListener("wheel", wheel, options);
    return () => {
      element.removeEventListener("gesturestart", start, true);
      element.removeEventListener("gesturechange", change, true);
      element.removeEventListener("gestureend", end, true);
      element.removeEventListener("wheel", wheel, true);
    };
  }, [rotationOn, inline, flow, pane, minZoom]);

  const worldAt = ({ x, y }: { x: number; y: number }) => {
    const r = pane()?.getBoundingClientRect();
    return screenToWorld({ x: x - (r?.left ?? 0), y: y - (r?.top ?? 0) }, { ...flow.getViewport(), angle });
  };
  const startFollowing = () => {
    setFollowing(true);
    const g = goal();
    if (g) camera.aim(g.box, { ring: g.ring });
  };
  /** The item nearest the middle of the view. */
  const middle = () => {
    const a = area();
    const view = { ...flow.getViewport(), angle };
    let best: Item | undefined;
    let nearest = Infinity;
    for (const item of layout.items) {
      const p = worldToScreen({ x: item.box.x + item.box.w / 2, y: item.box.y + item.box.h / 2 }, view);
      const d = Math.hypot(p.x - (a.x0 + a.x1) / 2, p.y - (a.y0 + a.y1) / 2);
      if (d < nearest) { nearest = d; best = item; }
    }
    return best;
  };
  const transform = (): [number, number, number] => { const v = flow.getViewport(); return [v.x, v.y, v.zoom]; };
  // Cues use the same rotated anchor as input, while their labels stay upright in screen space.
  const viewItem = (item: Item): Item => {
    if (!angle) return item;
    const p = rotatePoint({ x: item.box.x + item.box.w / 2, y: item.box.y + Math.min(item.box.h, 44) / 2 }, angle);
    return { ...item, box: { ...item.box, x: p.x - item.box.w / 2, y: p.y - Math.min(item.box.h, 44) / 2 } };
  };
  const cueLayout = { ...layout, byKey: new Map([...layout.byKey].map(([key, item]) => [key, viewItem(item)])) };

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
    if (item && !(mine && following) && !onScreen(viewItem(item), transform(), area()).inside) {
      const title = map.threads.find((t) => t.id === threadId)?.title ?? "";
      setCues((was) => [...was.filter((cue) => cue.thread !== item.thread), { key: item.key, thread: item.thread, title, at: Date.now() }]);
    }
  }, "spine");
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
      const text = frame.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(selecting.key)}"] .spine-words`);
      if (!selection || !selection.rangeCount || selection.isCollapsed || !text || !text.contains(selection.anchorNode) || !text.contains(selection.focusNode)) {
        setPicking((was) => (was?.typing ? was : null));
        return;
      }
      const range = selection.getRangeAt(0);
      const before = range.cloneRange();
      before.selectNodeContents(text);
      before.setEnd(range.startContainer, range.startOffset);
      const source = text.textContent ?? "";
      const quote = selection.toString();
      const thought = map.thoughts.find(t => t.id === selecting.thoughtId);
      if (!thought) return;
      const start = codePointOffset(source, before.toString().length);
      const context = { source_text: source, source_speaker: thought.speaker, start, end: start + [...quote].length };
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const frameBox = frame.current!.getBoundingClientRect();
      if (quote) setPicking((was) => (was?.typing ? was : { key: selecting.key, thoughtId: selecting.thoughtId, quote, context, x: rect.right - frameBox.left - 40, y: rect.bottom - frameBox.top, typing: false }));
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [selecting, map.thoughts]);

  const visitAfterLens = useRef<string | null>(null);
  useEffect(() => {
    const key = visitAfterLens.current;
    const item = key && layout.byKey.get(key);
    if (!item) return;
    visitAfterLens.current = null;
    camera.aim(item.box, { ring: item.key, zoom: readingZoom, instant: true });
    requestAnimationFrame(() => frame.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(item.key)}"] [data-spine-target]`)?.focus({ preventScroll: true }));
  }, [layout]);
  const acts = useMemo<Acts>(() => ({
    visit: (key) => {
      const item = layout.byKey.get(key);
      if (!item) {
        if (conversation && lens.view === "time" && key.startsWith("t:")) { visitAfterLens.current = key; switchLens("topics"); }
        return;
      }
      stopFollowing();
      setPicked(key);
      camera.aim(item.box, { ring: key, zoom: readingZoom, instant: true });
      requestAnimationFrame(() => frame.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(key)}"] [data-spine-target]`)?.focus({ preventScroll: true }));
    },
    resume: (id,keyboard) => { actions.resume?.(id,keyboard); },
    toggle: (thread) => { stopFollowing(); setOpen((was) => (was?.id === thread ? null : { id: thread, by: "you" })); },
    pick: (item) => { setPicked(item.key); if (!compare && item.thread) actions.select(item.thread); },
    words: (item) => { stopFollowing(); setOriginals((was) => { const next = new Set(was); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); },
    // Reached by Tab: brought into view, as a pointer would have to go there.
    focus: (item) => { if (!onScreen(viewItem(item), transform(), area()).inside) { stopFollowing(); camera.aim(item.box, { ring: item.key }); } },
    openOnMap: (thread) => actions.openThread(thread),
    read: (item) => { stopFollowing(); camera.aim(item.box, { zoom: readingZoom, ring: item.key }); },
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
      const element = frame.current?.querySelector(inline ? `.inline-phone [data-heads~="${CSS.escape(item.id)}"] .inline-words` : `.react-flow__node[data-id="${CSS.escape(item.key)}"]`)?.getBoundingClientRect();
      if (!frameBox || !element) return;
      if (item.kind === "margin") {
        const note = notes.margins.find((m) => m.id === item.margin);
        if (!note) return;
        setSelecting(null);
        setPicking({ key: item.key, thoughtId: note.thoughtId, quote: note.quote, context: note.context ?? undefined, x: element.left - frameBox.left, y: element.bottom - frameBox.top, typing: true });
        return;
      }
      const thoughtId = item.thoughts?.at(-1);
      if (!thoughtId) return;
      camera.hold();
      setPicking({ key: item.key, thoughtId, quote: quote ?? item.text ?? "", x: element.left - frameBox.left + (inline ? 0 : G.textX), y: inline ? Math.min(element.bottom - frameBox.top, area().y1 - 48) : element.top - frameBox.top + (item.lines?.length ?? 1) * (item.look?.line ?? G.pointLine), typing: true });
    },
    unfold: (margin) => setOpened((was) => { const next = new Set(was); if (next.has(margin)) next.delete(margin); else next.add(margin); return next; }),
    topics: topicNames,
    renameTopic: (from, to) => { actions.renameTopic(from, to); },
    moveToTopic: (thread, topic) => { if (actions.moveToTopic(thread, topic)) setMoving((was) => ({ ...was, [thread]: topic })); },
  }), [inline, compare, actions, put, shelf.items, notes.margins, layout, area, topicNames, angle]);

  // One dim (78%): what isn't the topic you're on while the view follows your talk, or what the Friend isn't pointing at.
  const focusTopic = pointing ? null : following && here && new Set(layout.items.map((item) => item.topic)).size > 1 ? here.topic : null;
  const thoughtCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thought of map.thoughts) if (thought.placed && thought.thread_id) counts.set(thought.thread_id, (counts.get(thought.thread_id) ?? 0) + 1);
    return counts;
  }, [map.thoughts]);
  const datas = useMemo(() => new Map(layout.items.map((item): [string, ItemData] => [item.key, {
    item,
    pauses: pauses.filter(p=>item.thoughts?.includes(p.thought_id)),
    overview: item.kind === "head" || item.kind === "card" || item.kind === "aside"
      ? [{ thread: item.thread, title: item.title ?? "", count: thoughtCounts.get(item.thread) ?? 0 }]
      : (item.tucks ?? []).filter((tuck) => tuck.thread).map((tuck) => ({ thread: tuck.thread!, title: tuck.title ?? "", count: thoughtCounts.get(tuck.thread!) ?? 0 })),
    here: item.key === hereKey, pulse: pulses[item.key] ?? 0, fresh: fresh.has(item.key), picked: picked === item.key,
    // A topic's header is where things are, never dimmed.
    dim: item.kind === "group" ? false : pointing ? item.thread !== pointing.thread : !!focusTopic && item.topic !== focusTopic,
    hot: item.kind === "group" && !!dropTo && item.group === dropTo,
    // A closed card is the slot of the tangent you're on (its points are folded inside it).
    arriving: arriving && item.thoughts?.includes(arriving) ? arriving
      : item.kind === "card" && !item.open && item.thread === map.active && slots.length ? slots[0] : null,
    cut: camera.cut === item.key, selecting: selecting?.key === item.key,
  }])), [pauses, layout, thoughtCounts, hereKey, pulses, fresh, picked, focusTopic, pointing, arriving, camera.cut, selecting, map.active, slotKey, dropTo]);
  const toolNodes = useCanvasToolNodes();
  const nodes: ItemNode[] = layout.items.map((item) => ({
    // Its size is known before it's drawn (layout.ts): said as measured, the canvas never measures it again (a node
    // without it is measured on every update, and a moving canvas would loop the browser's resize observer).
    id: item.key, type: "item", className: "spine-node", position: rotatePoint(at(item), angle), data: datas.get(item.key)!, width: item.box.w, height: item.box.h, measured: { width: item.box.w, height: item.box.h },
    draggable: !conversation && item.kind !== "notch" && item.kind !== "slot" && item.kind !== "margin" && item.kind !== "group", selectable: false, focusable: false, connectable: false,
    // Heads over points: far out, a topic's title covers the top of its own spine (in reach of a point, never at it).
    zIndex: (item.kind === "notch" || item.kind === "slot" || item.kind === "group" ? 0 : item.kind === "card" ? 1 : item.kind === "point" || item.kind === "aside" ? (item.look?.variant === "mini" ? 3 : 2) : item.kind === "margin" ? 3 : 4)
      + (item.pinned ? 5 : 0) + (group?.has(item.key) ? 20 : 0),
  }));

  // A drag: the thing follows the hand (with what's laid out from it), and every window sees each step.
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    for (const change of changes) {
      if (change.type !== "position" || !change.position || !change.dragging) continue;
      const item = layout.byKey.get(change.id);
      if (!item) continue;
      if (grip.current?.id !== item.id) grip.current = { id: item.id, was: map.positions[item.id] };
      const position = screenToWorld(change.position, { x: 0, y: 0, zoom: 1, angle });
      setDrag({ key: item.key, dx: position.x - item.box.x, dy: position.y - item.box.y });
      if (map.connected) actions.position(item.id, position.x, position.y);
    }
  }, [layout, map.positions, map.connected, actions, angle]);
  const pointer = (event: MouseEvent | TouchEvent) => ("touches" in event ? event.changedTouches[0] : event);
  /** The named topic whose columns a carried spine is over (anywhere over its header or its columns, a little past
   *  either end), when it isn't the spine's own: dropped there, the spine goes under it. Only a spine laid out by topic,
   *  and only while two or more topics are named. */
  const topicUnder = (event: MouseEvent | TouchEvent, item: Item | undefined) => {
    if (!item || item.kind !== "head" || layout.groups.length < 2) return null;
    const { clientX, clientY } = pointer(event);
    const at = worldAt({ x: clientX, y: clientY });
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
  // Overview fits the map on desktop; on a phone its minimum scale keeps names readable, with panning for the rest.
  const farOut = useStore((s) => s.transform[2] < READ);
  const shownStop: Stop = farOut ? (stop === "words" ? "titles" : stop) : "words";
  const overviewReading = useRef<string | null>(null);
  const overviewFocus = useRef(0);
  useEffect(() => {
    if (!overviewReading.current) return;
    const item = layout.byKey.get(`t:${overviewReading.current}`);
    if (!item) return;
    overviewReading.current = null;
    setPicked(item.key);
    camera.aim(item.box, { zoom: 1, ring: item.key, instant: true });
    const focusEpoch = ++overviewFocus.current;
    requestAnimationFrame(() => {
      if (focusEpoch !== overviewFocus.current) return;
      frame.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(item.key)}"] .spine-title, [data-id="${CSS.escape(item.key)}"] .spine-card-face, [data-id="${CSS.escape(item.key)}"] .spine-aside-face, [data-id="${CSS.escape(item.key)}"] .spine-topic-title, [data-id="${CSS.escape(item.key)}"] [data-spine-target]`)?.focus({ preventScroll: true });
    });
  }, [layout, stop, camera.aim]);
  const readOverview = (id: string) => {
    overviewReading.current = id;
    stopFollowing();
    if (conversation && lens.view === "time") switchLens("topics");
    setStop("words");
    if (map.threads.find(thread => thread.id === id)?.parent_id) setOpen({ id, by: "you" });
  };
  const choose = (next: Stop) => {
    overviewReading.current = null;
    overviewFocus.current++;
    setStop(next);
    if (next === "words") {
      // Read is an explicit return to the active source/input, even while automatic following is paused.
      const g = goal();
      const target = g?.box ?? middle()?.box;
      if (target) camera.aim(target, { zoom: readingZoom, ring: g?.ring });
      return;
    }
    stopFollowing();
    // The usual title measure, resized from 18 px to 13 px, plus the label's 6 px padding.
    const titleZoom = (G.titleW * 13 / 18 + 2 * 6) / G.colW;
    camera.fit(all(), next === "titles" ? 0.6 : 0.42, next === "titles" ? Math.max(minZoom, titleZoom) : narrow ? Math.max(minZoom, 0.38) : minZoom);
  };
  const seeAll = () => { stopFollowing(); camera.fit(all(), readingZoom, minZoom); };

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
    else if (key === "s") setShelfOpen((was) => !was);
    else if (key === "+" || key === "=") { stopFollowing(); void flow.zoomIn({ duration: reduced ? 0 : 200 }); }
    else if (key === "-") { stopFollowing(); void flow.zoomOut({ duration: reduced ? 0 : 200 }); }
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    if (inline) return;
    const keydown = (event: KeyboardEvent) => keyed.current(event);
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [inline]);

  const ready_ = ready && top !== null;
  const rowStyle = { bottom: corner.row };
  const rotationControl = rotationOn && !inline && <div ref={rotationControls} className="spine-rotation" role="group" aria-label="Rotate canvas">
        <label>Angle <input type="number" aria-label="Canvas angle in degrees" min={-180} max={180} step={5} value={Math.round(angle * 100) / 100}
          onChange={(e) => { if (e.currentTarget.value !== "") turnTo(e.currentTarget.valueAsNumber); }} />°</label>
        <button type="button" onClick={() => turnTo(0)}>Reset angle</button>
        <span>{"GestureEvent" in window ? "Browser rotation gestures available; or use Angle." : "Rotation gestures unavailable here; use Angle."}</span>
      </div>;
  return <div className="spine">
    <div ref={anchor} className="spine-anchor" style={{ height: box?.tall ?? 0 }} />
    <div ref={frame} tabIndex={-1} {...threadReveal.handlers} data-rotation-angle={angle} data-lens={conversation ? lens.view : undefined} className={cls("spine-frame", loose && "spine-loose", rotationOn && "spine-rotating", ready_ && "spine-ready", !semantic && shownStop === "pictures" && "spine-stop-pictures", narrow && "spine-narrow", compare && "spine-phone-compare")} data-phone-bounds={compare ? JSON.stringify(phoneArea) : undefined} data-phone-reading-mode={compare ? inline ? "inline" : "spatial" : undefined} style={{ "--phone-text-scale": textScale, top: top ?? 0, left: box?.left ?? 0, right: box?.right ?? 0 } as React.CSSProperties}>
      {compare && <div ref={phoneControls} className="phone-controls" style={{ "--phone-text-scale": textScale } as React.CSSProperties}>
        <div role="group" aria-label="Compare phone reading">
          <button type="button" aria-pressed={!inline} onClick={() => setReadingMode("spatial")}>Spatial</button>
          <button type="button" aria-pressed={inline} onClick={() => { tools?.exit(); setReadingMode("inline"); }}>Inline</button>
          <details><summary>Topics</summary><div className="phone-topic-list">
            <button type="button" onClick={() => { if (!inline) seeAll(); else frame.current?.querySelector('.inline-phone')?.scrollTo({ top: 0 }); }}>See all</button>
            {map.threads.map(t => <button type="button" key={t.id} data-phone-open={t.id} onClick={event => {
              const first = map.thoughts.find(p => p.thread_id === t.id && p.placed);
              inspect(t.id, first?.id ?? null);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}>{t.title}</button>)}
            {map.thoughts.filter(p => p.placed && p.thread_id).map(p => <button type="button" key={p.id} data-phone-point={p.id} onClick={event => { inspect(p.thread_id!, p.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{p.point || p.text} [{p.id}]</button>)}
          </div></details>
        </div>
        {inspected && parents.get(inspected)?.label && <button type="button" className="phone-back" data-source-id={parents.get(inspected)?.thoughtId ?? undefined}
          disabled={!parents.get(inspected)?.threadId || parents.get(inspected)?.missing}
          onClick={() => { const p = parents.get(inspected); if (p?.threadId) inspect(p.threadId, p.thoughtId); }}>Back to {parents.get(inspected)?.label}</button>}
        {rotationControl}
      </div>}
      {compare && <div className="phone-safe" aria-hidden="true" />}
      <ActsContext.Provider value={acts}>
      <NowContext.Provider value={now}>
      {inline && <InlinePhone map={map} destination={destination} layout={layout} data={datas} area={phoneArea} visit={inspect} />}
      <div className="spatial-reading-mode" inert={inline} aria-hidden={inline || undefined} style={{ visibility: inline ? "hidden" : undefined }}>
      <RotationAngle.Provider value={angle}>
      <ReactFlow<CanvasNode>
        defaultViewport={state ? viewport : undefined} onMoveEnd={state ? (_event, next) => setViewport(next) : undefined}
        className={cls("spine-flow", semantic && "spine-semantic")} nodes={[...nodes, ...toolNodes.nodes, ...captureNodes.nodes]} edges={[]} nodeTypes={rotationOn ? ROTATED_NODE_TYPES : NODE_TYPES} onNodesChange={(changes) => { toolNodes.change(changes); onNodesChange(changes); }}
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
          } else {
            const position = screenToWorld(node.position, { x: 0, y: 0, zoom: 1, angle });
            put(item.id, position.x, position.y);
          }
        }}
        onMoveStart={(event) => { if (event) { stopFollowing(); if (!picking?.typing) unpick(); } }}
        onPaneClick={() => { setPicked(null); if (!picking?.typing) unpick(); }}
        minZoom={minZoom} maxZoom={loose ? 3 : 2} nodeDragThreshold={DRAG}
        panOnScroll zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} elementsSelectable={false}
        nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} proOptions={{ hideAttribution: true }}
        aria-label={conversation ? `Your thoughts by ${lens.view}. Drag the canvas to look around.` : "Your topics on the canvas: drag the canvas to look around, pinch or Ctrl and scroll to zoom; 1, 2 and 3 for words, titles and pictures"}>
        <Background className="spine-grid" variant={BackgroundVariant.Dots} gap={28} size={1.2} />
        <ZoomVar semantic={semantic} />
        <CanvasShapes />
        <CanvasToolControls hold={stopFollowing} />
        <CaptureAccess box={captureNodes.activeBox} free={area()} reveal={() => {
          if (captureNodes.activeBox) camera.aim(captureNodes.activeBox, { zoom: readingZoom });
          capture?.host.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
        }} />
        <PhoneNavigation map={map} layout={layout} hold={stopFollowing} overview={() => { setOriginals(new Set()); setOpen(null); camera.fit(all(), readingZoom, minZoom); }} reveal={(thread, thought, opened) => {
          stopFollowing();
          const topic = map.threads.find((t) => t.id === thread);
          if (topic?.parent_id) setOpen({ id: thread, by: "you" });
          const item = (thought ? layout.items.find((item) => item.thoughts?.includes(thought)) : undefined) ?? layout.byKey.get(`t:${thread}`);
          if (item) {
            setPicked(item.key);
            if (opened) setOriginals((was) => new Set([...was, item.id]));
            else setOriginals(new Set());
            camera.aim(item.box, { ring: item.key, zoom: opened ? 1 : undefined, instant: true });
          }
        }} />
        <EdgeLabelRenderer>
          <svg className="spine-links" aria-hidden="true">
            <g transform={`rotate(${angle})`}>{layout.links.map((link) => {
              const d = loose && (link.kind === "spine" || link.kind === "slot") ? looseThread(link, layout, linkEnd(link)) : pathOf(link, linkEnd(link));
              const drawn = fresh.has(link.key) && link.kind !== "pulled" && link.kind !== "slot";
              const dim = pointing ? !!link.topic && layout.byKey.get(link.to.key)?.thread !== pointing.thread : !!focusTopic && link.topic !== focusTopic;
              const start = link.kind === "branch" || link.kind === "note" ? linkEnd(link)(link.from) : null;
              return d && <g key={link.key} className={cls(dim && "spine-link-dim")}>
                <path d={d} className={cls("spine-link", LINK_CLASS[link.kind], threadReveal.visible(link) && "spine-loose-reveal", drawn && "spine-draw")}
                  pathLength={drawn ? 1 : undefined} style={{ stroke: link.room && link.kind !== "note" ? `var(--room-${link.room})` : undefined }} />
                {start && <circle className={cls("spine-link-end", link.kind === "note" && "spine-link-end-note")} cx={start.x} cy={start.y} r={2.2}
                  style={{ fill: link.room && link.kind !== "note" ? `var(--room-${link.room})` : undefined }} />}
              </g>;
            })}</g>
          </svg>
        </EdgeLabelRenderer>
      </ReactFlow>
      </RotationAngle.Provider>
      </div>
      {!narrow && <Cues cues={cues} layout={cueLayout} area={area} avoid={avoid} width={width} narrow={false} go={goTo} seen={seenCues} />}
      </NowContext.Provider>
      </ActsContext.Provider>
      {!compare && rotationControl}
      {picking && <Reply key={`${picking.key}|${picking.quote}`} picking={picking} width={width} start={() => setPicking({ ...picking, typing: true })} cancel={() => { unpick(); getSelection()?.removeAllRanges(); }}
        send={(text) => { if (!notes.add(picking.thoughtId, picking.quote, text, picking.context)) return false; unpick(); getSelection()?.removeAllRanges(); return true; }} />}
      {/* The camera's corner: bottom left in the shell that has a stage (its regions); in the app without one, over the
          shelf at the right, where the left is the notice timeline's. */}
      {!narrow && corner.shell && <div className="spine-corner spine-corner-left" style={{ bottom: corner.bottom }}>
        <Corner following={following} lens={conversation ? lens.view : undefined} switchLens={switchLens} title={conversation ? (lens.view === "time" ? "Time" : "Topics") : activeThread?.title ?? ""} stop={shownStop} narrow={false} follow={() => (following ? stopFollowing() : startFollowing())} seeAll={seeAll} choose={choose} />
      </div>}
      <div className={cls("spine-corner", narrow ? "spine-corner-row" : "spine-corner-right")} style={narrow ? rowStyle : { bottom: corner.bottomRight }}>
        {narrow && <Cues cues={cues} layout={cueLayout} area={area} avoid={avoid} width={width} narrow go={goTo} seen={seenCues} />}
        {narrow && parts.has("phone-topic-overview") && shownStop === "pictures" && <PhoneOverview topics={map.threads.map(thread => ({ id: thread.id, title: thread.title,
          parent: map.threads.find(parent => parent.id === thread.parent_id)?.title, count: thoughtCounts.get(thread.id) ?? 0 }))} read={readOverview} />}
        {(narrow || !corner.shell) && <Corner following={following} lens={conversation ? lens.view : undefined} switchLens={switchLens} title={conversation ? (lens.view === "time" ? "Time" : "Topics") : activeThread?.title ?? ""} stop={shownStop} narrow={narrow} follow={() => (following ? stopFollowing() : startFollowing())} seeAll={seeAll} choose={choose} />}
        <Shelf ref={shelfRef} entries={layout.shelf} carrying={!!drag} hot={overShelf} open={shelfOpen} setOpen={setShelfOpen} narrow={narrow}
          putBack={(id) => shelf.remove(id)}
          place={(id, x, y) => {
            const frameBox = frame.current?.getBoundingClientRect();
            const p = worldAt({ x, y });
            if (frameBox && y < frameBox.top + area().y1 && put(id, p.x - G.lineX, p.y - G.dotY)) shelf.remove(id);
          }} />
      </div>
    </div>
  </div>;
}

const NODE_TYPES = { item: ItemView, canvasTool: CanvasToolNode, capture: CaptureView };
// React Flow pans/zooms the projected plane. Each item's contents turn around its projected origin; its native
// drag deltas are inverse-mapped above before any action is sent to World.
function RotatedItem(props: NodeProps<ItemNode>) {
  const angle = useContext(RotationAngle);
  return <div className="spine-rotated-item" style={{ transform: `rotate(${angle}deg)` }}><ItemView {...props} /></div>;
}
const RotationAngle = createContext(0);
const ROTATED_NODE_TYPES = { ...NODE_TYPES, item: RotatedItem };

/** The zoom, as `--spine-k` (1 / zoom), for what keeps its size on screen however far out you are (a topic's title). */
function ZoomVar({ semantic }: { semantic: boolean }) {
  const store = useStoreApi();
  const refresh = useRef<(() => void) | null>(null);
  // New summaries and gliding/dragged nodes also need room at the current zoom.
  useLayoutEffect(() => { refresh.current?.(); });
  useEffect(() => {
    let last = 0;
    let frame = 0;
    const element = store.getState().domNode;
    if (!element) return;
    const space = () => {
      if (!semantic) return;
      const state = store.getState(), zoom = state.transform[2];
      // Read all sizes before writing transforms. Fixed screen widths keep wrapping stable as zoom changes.
      const summaries = [...element.querySelectorAll<HTMLElement>('.spine-semantic-summary')].map((label) => {
        const id = label.closest<HTMLElement>('.react-flow__node')?.dataset.id;
        const position = id && state.nodeLookup.get(id)?.internals.positionAbsolute;
        return { label, x: (position ? position.x : 0) * zoom, y: ((position ? position.y : 0) + label.offsetTop) * zoom,
          order: (position ? position.y : 0) + Number(label.dataset.semanticOrder ?? 0),
          w: label.offsetWidth, h: label.offsetHeight };
      }).sort((a, b) => a.order - b.order || a.x - b.x || (a.label.dataset.thread ?? '').localeCompare(b.label.dataset.thread ?? ''));
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const shifts: { label: HTMLElement; shift: number }[] = [];
      for (const summary of summaries) {
        let y = summary.y;
        // Start making room 32 screen px before columns meet, reaching full clearance at an 8 px gap.
        // Stable world order and continuous offsets avoid a sudden row swap while pinching either way.
        for (const p of placed) {
          const gap = Math.max(p.x - summary.x - summary.w, summary.x - p.x - p.w);
          const t = Math.max(0, Math.min(1, (40 - gap) / 32));
          y = Math.max(y, summary.y + Math.max(0, p.y + p.h + 8 - summary.y) * t * t * (3 - 2 * t));
        }
        placed.push({ ...summary, y });
        shifts.push({ label: summary.label, shift: y - summary.y });
      }
      for (const { label, shift } of shifts) label.style.setProperty('--semantic-shift', `${shift}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(space);
    };
    refresh.current = schedule;
    const set = (zoom: number) => {
      if (zoom === last) return;
      last = zoom;
      element.style.setProperty("--spine-k", String(1 / zoom));
      element.style.setProperty("--spine-z", String(zoom));
      if (semantic) for (const [suffix, size] of [["", 15], ["-small", 13]] as const) {
        const detail = semanticBlend(zoom, size);
        element.style.setProperty(`--semantic-detail${suffix}`, String(detail));
        element.style.setProperty(`--semantic-overview${suffix}`, String(1 - detail));
        element.style.setProperty(`--semantic-detail-visible${suffix}`, detail === 0 ? "hidden" : "visible");
        element.style.setProperty(`--semantic-overview-visible${suffix}`, detail === 1 ? "hidden" : "visible");
      }
      space();
    };
    set(store.getState().transform[2]);
    const unsubscribe = store.subscribe((state) => set(state.transform[2]));
    const resize = new ResizeObserver(schedule);
    const watch = () => {
      element.querySelectorAll('.spine-semantic-summary').forEach((label) => resize.observe(label));
      schedule();
    };
    const added = new MutationObserver(watch);
    if (semantic) { added.observe(element, { childList: true, subtree: true }); watch(); }
    return () => { unsubscribe(); resize.disconnect(); added.disconnect(); cancelAnimationFrame(frame); refresh.current = null; };
  }, [store, semantic]);
  return null;
}

/** Host attaches these styles only for this mount. */
export const styles = pluginStyle0 + "\n" + pluginStyle1 + "\n" + looseTopicStyles;
