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
const ROW = 40;

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

export function Cues({ cues, layout, area, width, narrow, go, seen }: {
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
  const placed: { edge: Edge; along: number }[] = [];

  const chip = (cue: Cue, label: string, first: boolean, extra?: number) => {
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
    // Along the line from the middle toward it, stopped at the edge.
    const left = a.x0 + INSET, right = a.x1 - INSET, top = a.y0 + INSET, bottom = a.y1 - INSET;
    let t = Infinity;
    let edge: Edge = "right";
    if (dx > 0 && (right - mx) / dx < t) { t = (right - mx) / dx; edge = "right"; }
    if (dx < 0 && (left - mx) / dx < t) { t = (left - mx) / dx; edge = "left"; }
    if (dy > 0 && (bottom - my) / dy < t) { t = (bottom - my) / dy; edge = "bottom"; }
    if (dy < 0 && (top - my) / dy < t) { t = (top - my) / dy; edge = "top"; }
    const vertical = edge === "left" || edge === "right";
    let along = vertical ? Math.max(top + ROW / 2, Math.min(bottom - ROW / 2, my + dy * t)) : Math.max(left + 120, Math.min(right - 120, mx + dx * t));
    // Several on one edge stack, a row apart, never on top of each other.
    while (placed.some((p) => p.edge === edge && Math.abs(p.along - along) < (vertical ? ROW : 240))) along += vertical ? (along > my ? -ROW : ROW) : (along > mx ? -240 : 240);
    placed.push({ edge, along });
    const style = { ...roomStyle(item.room),
      ...(edge === "right" ? { right: width - right, top: along } : edge === "left" ? { left, top: along } : edge === "top" ? { top, left: along } : { top: bottom, left: along }) };
    return <button key={cue.key} type="button" className={cls("spine-cue", EDGE_CLASS[edge])} style={style} onClick={() => go(cue)} aria-label={name}>{body}</button>;
  };

  const chips = shown.map((cue, i) => chip(cue, cue.title, i === 0));
  if (waiting.length) chips.push(chip(waiting[waiting.length - 1], `+${waiting.length}`, false, waiting.length));
  return narrow ? <div className="spine-cue-line" role="group" aria-label="New out of view">{chips}</div>
    : <div className="spine-cues" role="group" aria-label="New out of view">{chips}</div>;
}
