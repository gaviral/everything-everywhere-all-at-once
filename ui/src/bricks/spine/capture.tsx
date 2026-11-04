import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { Panel, useStore, type Node, type NodeProps } from "@xyflow/react";
import { ToolSlot, type MapSnapshot } from "../contract";
import type { Box, Layout } from "./layout";

export type CaptureRow = { id: string; text: string; thoughtIds: string[]; waiting: boolean; status: string; saved: boolean; retry?: () => void };
export const CaptureContext = createContext<{
  host: HTMLElement; words: string; draft: boolean; rows: CaptureRow[]; micText: string;
} | null>(null);
export type CaptureNode = Node<{ row?: CaptureRow; words?: string; host?: HTMLElement }, "capture">;

const W = 300, GAP = 48;
const collides = (a: Box, b: Box) => a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
/** Search clear space beside the last landing first, then below it. Never move existing map items. */
function roomNear(at: Box | undefined, occupied: Box[], height: number): Box {
  if (!at && !occupied.length) return { x: 0, y: 0, w: W, h: height };
  const origin = at ?? occupied[occupied.length - 1];
  const right = { x: origin.x + origin.w + GAP, y: origin.y, w: W, h: height };
  if (innerWidth > 560 && !occupied.some(box => collides(right, box))) return right;
  let next = { x: origin.x, y: origin.y + origin.h + GAP, w: W, h: height };
  for (let tries = 0; tries <= occupied.length; tries++) {
    const hit = occupied.find(box => collides(next, box));
    if (!hit) return next;
    next = { ...next, y: hit.y + hit.h + GAP };
  }
  return next;
}

/** Capture locations belong to this visit. Saved thoughts and hand-placed map positions remain core-owned. */
export function useCaptureNodes(layout: Layout, map: MapSnapshot) {
  const capture = useContext(CaptureContext);
  const origins = useRef(new Map<string, Box>());
  const finished = useRef(new Set<string>());
  const active = useRef<Box | undefined>(undefined);
  const visit = useRef(map.visitKey);
  if (visit.current !== map.visitKey) {
    visit.current = map.visitKey;
    origins.current.clear(); finished.current.clear(); active.current = undefined;
  }
  const [height, setHeight] = useState(230);
  useLayoutEffect(() => {
    if (!capture) return;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.max(190, Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height + 14))));
    observer.observe(capture.host.closest(".map-capture") ?? capture.host);
    return () => observer.disconnect();
  }, [capture?.host]);
  if (!capture) return { nodes: [] as CaptureNode[], seeds: new Map<string, Box>(), box: undefined, activeBox: undefined };
  const occupied = layout.items.filter(item => item.kind !== "slot" && item.kind !== "group").map(item => item.box);
  const latest = [...map.thoughts].reverse().find(thought => thought.speaker === map.me && thought.placed);
  const recent = [...capture.rows].reverse().find(row => !row.waiting && origins.current.has(row.id));
  const captured = recent && layout.items.find(item => item.thoughts?.some(id => recent.thoughtIds.includes(id)));
  const tip = map.active && layout.tips.get(map.active);
  const last = captured || (tip ? layout.byKey.get(tip) : undefined) || (latest && layout.items.find(item => item.thoughts?.includes(latest.id)));
  active.current ??= roomNear(last?.box, occupied, height);
  for (const row of capture.rows) {
    if (row.waiting && !origins.current.has(row.id)) {
      active.current ??= roomNear(last?.box, [...occupied, ...origins.current.values()], height);
      origins.current.set(row.id, { ...active.current, h: Math.min(360, Math.max(160, 100 + Math.ceil(row.text.length / 30) * 24)) });
      active.current = undefined;
    }
  }
  const waiting = capture.rows.filter(row => row.waiting);
  const waitingBoxes = waiting.map(row => origins.current.get(row.id)!).filter(Boolean);
  const seeds = new Map<string, Box>();
  for (const row of capture.rows) {
    const origin = origins.current.get(row.id);
    if (!origin || row.waiting || finished.current.has(row.id)) continue;
    const target = layout.items.find(item => item.thoughts?.some(id => row.thoughtIds.includes(id)));
    if (!target) continue;
    seeds.set(target.key, { ...origin, x: origin.x - (target.look?.textX ?? 0) + 20, y: origin.y + 38 });
    finished.current.add(row.id);
    // A draft or live utterance already in progress keeps its own place.
    if (!capture.draft && !capture.words) active.current = undefined;
  }
  const previous = waitingBoxes.at(-1) ?? last?.box;
  active.current ??= roomNear(previous, [...occupied, ...waitingBoxes], height);
  // Text can grow while speaking: reserve the measured height before another turn starts.
  active.current = { ...active.current, h: height };
  if ([...occupied, ...waitingBoxes].some(box => collides(active.current!, box))) {
    active.current = roomNear(previous, [...occupied, ...waitingBoxes], height);
  }
  const node = (id: string, box: Box, data: CaptureNode["data"]): CaptureNode => ({ id, type: "capture", position: { x: box.x, y: box.y }, width: W, height: box.h, className: id === "capture:active" ? "capture-anchor" : undefined,
    data, draggable: false, selectable: false, connectable: false, focusable: false, zIndex: 20 });
  const focus = waitingBoxes.at(-1) ?? last?.box;
  const boxes = focus ? [focus, active.current] : [active.current];
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const focusBox = { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
  return { nodes: [
    ...waiting.map(row => node(`capture:${row.id}`, origins.current.get(row.id)!, { row })),
    node("capture:active", active.current, { host: capture.host, words: capture.words }),
  ], seeds, box: focusBox, activeBox: active.current };
}

export function CaptureView({ data }: NodeProps<CaptureNode>) {
  const row = data.row;
  const live = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (live.current) live.current.scrollTop = live.current.scrollHeight; }, [data.words]);
  return <section className={`map-capture nodrag nopan nowheel${data.words ? " map-capture-speaking" : ""}${row ? " map-capture-waiting" : ""}`} data-map-capture={row?.id ?? "active"}
    data-capture={row?.id} data-saved={row?.saved} aria-label={row ? `${row.status}: ${row.text}` : "Your next thought"}>
    <div className="map-capture-heading"><i aria-hidden="true" />New thought</div>
    {row ? <><p className="map-capture-words">{row.text}</p><div className="map-capture-state">{row.status}
      {row.retry && <button className="shell-btn" type="button" onClick={row.retry}>Retry</button>}</div></>
      : <>{data.words && <div className="map-capture-live"><p ref={live}>{data.words}<i aria-hidden="true" /></p></div>}
        {data.host && <ToolSlot host={data.host} />}</>}
  </section>;
}

/** Exploration can leave capture off screen. Keep a named route back to the real input and its mic. */
export function CaptureAccess({ box, free, reveal }: { box?: Box; free: { x0: number; y0: number; x1: number; y1: number }; reveal: () => void }) {
  const capture = useContext(CaptureContext);
  const x = useStore(state => state.transform[0]);
  const y = useStore(state => state.transform[1]);
  const zoom = useStore(state => state.transform[2]);
  if (!capture || !box) return null;
  const left = box.x * zoom + x, top = box.y * zoom + y;
  if (left >= free.x0 && left + box.w * zoom <= free.x1 && top >= free.y0 + 8 && top + box.h * zoom <= free.y1 - 8) return null;
  return <Panel position="top-center" className="capture-return" style={{ top: free.y0 + 12, marginTop: 0 }}><button type="button" onClick={reveal}>
    <span>{capture.micText}</span><span>Return to input ↗</span>
  </button></Panel>;
}
