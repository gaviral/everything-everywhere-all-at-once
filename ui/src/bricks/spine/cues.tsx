// Edge chips: something new landed out of view. Each sits where the line from the middle of the view toward it crosses
// the edge, with its thread's color and title and "new", and stays until it's seen (it comes into view, or its chip is
// clicked), not for a guessed time. Four at most, newest first; the rest wait behind "+N". A phone has no room at its
// edges for words: there they line up above the composer, each with the way to go.
import { useEffect } from "react";
import { useStore } from "@xyflow/react";
import type { Area } from "./camera";
import type { Item, Layout } from "./layout";
import { roomStyle } from "./nodes";

export interface Cue {
  /** The canvas key of what landed (a point, a card, an aside). */
  key: string;
  thread: string;
  title: string;
  at: number;
}

/** Chips shown at once; the rest wait behind "+N". A phone's row has room for two. */
export const CUES_SHOWN = 4;
const CUES_SHOWN_NARROW = 2;
const INSET = 16;
const CHIP_WIDTH = 240;
const CHIP_HEIGHT = 34;
const GAP = 6;

const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

/** Where an item's middle is on screen, and whether it's in the part nothing covers. */
export function onScreen(item: Item, transform: [number, number, number], area: Area) {
  const [x, y, zoom] = transform;
  const cx = (item.box.x + item.box.w / 2) * zoom + x;
  const cy = (item.box.y + Math.min(item.box.h, 44) / 2) * zoom + y;
  return { cx, cy, inside: cx > area.x0 && cx < area.x1 && cy > area.y0 && cy < area.y1 };
}

type Edge = "left" | "right" | "top" | "bottom";
const EDGE_CLASS: Record<Edge, string> = { left: "spine-cue-left", right: "spine-cue-right", top: "spine-cue-top", bottom: "spine-cue-bottom" };

export type CueTarget = Cue & { cx: number; cy: number };
export interface CuePlacement {
  cue: CueTarget; edge: Edge; x: number; y: number; width: number; height: number; extra: number;
}

/** Finite edge slots, newest first. Hidden arrivals remain in the aggregate, even when the area collapses. */
export function placeCues(cues: readonly CueTarget[], area: Area): { chips: CuePlacement[]; hidden: CueTarget[] } {
  const newest = cues.map((cue, i) => ({ cue, i })).sort((a, b) => b.cue.at - a.cue.at || a.i - b.i).map(({ cue }) => cue);
  const finite = [area.x0, area.y0, area.x1, area.y1].every(Number.isFinite);
  const w = area.x1 - area.x0, h = area.y1 - area.y0;
  if (!finite || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { chips: [], hidden: newest };
  const ix = Math.min(INSET, Math.max(0, (w - CHIP_WIDTH) / 2));
  const iy = Math.min(INSET, Math.max(0, (h - CHIP_HEIGHT) / 2));
  const left = area.x0 + ix, top = area.y0 + iy, right = area.x1 - ix, bottom = area.y1 - iy;
  const width = Math.min(CHIP_WIDTH, right - left), height = Math.min(CHIP_HEIGHT, bottom - top);
  const mx = left + (right - left) / 2, my = top + (bottom - top) / 2;
  const slots: Omit<CuePlacement, "cue" | "extra">[] = [];
  for (const edge of ["left", "right", "top", "bottom"] as Edge[]) {
    const vertical = edge === "left" || edge === "right";
    const span = vertical ? bottom - top : right - left, size = vertical ? height : width;
    const count = Math.min(CUES_SHOWN + 1, Math.floor((span + GAP) / (size + GAP)));
    for (let i = 0; i < count; i++) {
      const along = count === 1 ? (span - size) / 2 : i * (span - size) / (count - 1);
      slots.push({ edge, x: vertical ? (edge === "left" ? left : right - width) : left + along,
        y: vertical ? top + along : edge === "top" ? top : bottom - height, width, height });
    }
  }
  const target = (cue: CueTarget) => {
    const dx = Number.isFinite(cue.cx) ? cue.cx - mx : 0, dy = Number.isFinite(cue.cy) ? cue.cy - my : 0;
    const tx = dx ? (right - left) / 2 / Math.abs(dx) : Infinity;
    const ty = dy ? (bottom - top) / 2 / Math.abs(dy) : Infinity;
    const edge: Edge = tx < ty ? (dx < 0 ? "left" : "right") : (dy < 0 ? "top" : "bottom");
    const t = Math.min(tx, ty);
    return { edge, x: Number.isFinite(t) ? mx + dx * t : mx, y: Number.isFinite(t) ? my + dy * t : my };
  };
  const chips: CuePlacement[] = [], hidden: CueTarget[] = [];
  const overlaps = (a: typeof slots[number], b: typeof slots[number]) =>
    a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;
  const pick = (cue: CueTarget) => {
    const aim = target(cue);
    return slots.filter((slot) => slot.edge === aim.edge && !chips.some((p) => overlaps(p, slot)))
      .sort((a, b) => Math.hypot(a.x + width / 2 - aim.x, a.y + height / 2 - aim.y) - Math.hypot(b.x + width / 2 - aim.x, b.y + height / 2 - aim.y))[0];
  };
  for (const cue of newest) {
    const slot = chips.length < CUES_SHOWN ? pick(cue) : undefined;
    if (slot) chips.push({ ...slot, cue, extra: 0 });
    else hidden.push(cue);
  }
  // Reserving an aggregate may displace a newer cue on another edge. Retarget on
  // that edge before placing it; each retry removes a chip, so this stays bounded.
  for (let attempt = 0; hidden.length && attempt <= CUES_SHOWN; attempt++) {
    hidden.sort((a, b) => newest.indexOf(a) - newest.indexOf(b));
    const next = hidden[0];
    let slot = pick(next);
    if (!slot) {
      // Reserve an aggregate on its own edge, preferring to hide older chips.
      const aim = target(next);
      const cost = (s: typeof slots[number]) => chips.reduce((sum, p, i) => sum + (overlaps(s, p) ? 2 ** (CUES_SHOWN - i) : 0), 0);
      slot = slots.filter((s) => s.edge === aim.edge).sort((a, b) => cost(a) - cost(b))[0];
      if (slot) for (let i = chips.length - 1; i >= 0; i--) {
        if (overlaps(slot, chips[i])) hidden.push(chips.splice(i, 1)[0].cue);
      }
    }
    hidden.sort((a, b) => newest.indexOf(a) - newest.indexOf(b));
    if (hidden[0] !== next) continue;
    if (slot) chips.push({ ...slot, cue: next, extra: hidden.length });
    break;
  }
  return { chips, hidden };
}

export function Cues({ cues, layout, area, narrow, go, seen }: {
  cues: Cue[]; layout: Layout; area: () => Area; width: number; narrow: boolean;
  go(cue: Cue): void;
  /** These came into view: their chips go. */
  seen(keys: string[]): void;
}) {
  const transform = useStore((s) => s.transform);
  const a = area();
  const visible = cues.filter((cue) => {
    const item = layout.byKey.get(cue.key);
    return item && !onScreen(item, transform, a).inside;
  });
  const gone = cues.filter((cue) => !visible.includes(cue)).map((cue) => cue.key);
  useEffect(() => { if (gone.length) seen(gone); }, [gone.join("|")]);
  if (!visible.length) return null;
  const newest = [...visible].sort((p, q) => q.at - p.at);
  const room = narrow ? CUES_SHOWN_NARROW : CUES_SHOWN;
  const shown = newest.slice(0, room);
  const waiting = newest.slice(room);
  const mx = (a.x0 + a.x1) / 2, my = (a.y0 + a.y1) / 2;

  const chip = (cue: Cue, label: string, first: boolean, extra?: number, placement?: CuePlacement) => {
    const item = layout.byKey.get(cue.key)!;
    const { cx, cy } = onScreen(item, transform, a);
    const dx = cx - mx, dy = cy - my;
    const angle = Math.atan2(dy, dx);
    const way = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    // The way to go: toward it on the edge; on a phone's row, the nearest of the four.
    const turn = narrow ? { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[way] : angle;
    const chevron = <svg className="spine-cue-way" viewBox="0 0 16 16" width="14" height="14" style={{ rotate: `${turn}rad` }} aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
    const body = <>
      {narrow && way === "left" && chevron}
      <span className="spine-cue-dot" aria-hidden="true" />
      <span className="spine-cue-title">{label}</span>
      {!narrow && !extra && <span className="spine-cue-new">new</span>}
      {(!narrow || way !== "left") && chevron}
      {first && !narrow && <kbd className="spine-key">N</kbd>}
    </>;
    const name = extra ? `${extra} more new out of view: go to the next` : `New on ${cue.title}, out of view (${way}): go there`;
    if (narrow) return <button key={cue.key} type="button" className="spine-cue spine-cue-row" style={roomStyle(item.room)} onClick={() => go(cue)} aria-label={name}>{body}</button>;
    const p = placement!;
    const style = { ...roomStyle(item.room), left: p.x, top: p.y, width: p.width, maxWidth: p.width, height: p.height,
      paddingLeft: Math.min(12, p.width / 4), paddingRight: Math.min(10, p.width / 4), borderWidth: Math.min(1, p.width / 4, p.height / 4) };
    return <button key={cue.key} type="button" className={cls("spine-cue", EDGE_CLASS[p.edge])} style={style} onClick={() => go(cue)} aria-label={name}>{body}</button>;
  };

  const chips = narrow ? shown.map((cue, i) => chip(cue, cue.title, i === 0)) : placeCues(visible.map((cue) => {
    const { cx, cy } = onScreen(layout.byKey.get(cue.key)!, transform, a);
    return { ...cue, cx, cy };
  }), a).chips.map((p) => chip(p.cue, p.extra ? `+${p.extra}` : p.cue.title, p.cue.key === newest[0].key, p.extra, p));
  if (narrow && waiting.length) chips.push(chip(waiting[waiting.length - 1], `+${waiting.length}`, false, waiting.length));
  return narrow ? <div className="spine-cue-line" role="group" aria-label="New out of view">{chips}</div>
    : <div className="spine-cues" role="group" aria-label="New out of view">{chips}</div>;
}
