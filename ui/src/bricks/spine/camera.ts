// The camera: where the view goes, and how it gets there. Within a screen it glides, 400 ms at most (by distance), so
// the eye can track where things went; past a screen a glide is a blur nobody can read, so it cross-fades in 200 ms
// (out, cut, in). Under Reduce Motion it cuts, and a ring shows for a second where it went. The follow keeps your
// latest point in a comfortable middle (a dead zone: it moves only once the point leaves it), moves at most once a
// landing and never within 2.5 s of its last move (a pause in talk: a burst of landings is one move, to the latest),
// and a hand on the map holds it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Box } from "./layout";
import { READ } from "./nodes";

export type Viewport = { x: number; y: number; zoom: number };
/** What the camera needs of React Flow's instance. */
export interface Flow {
  getViewport(): Viewport;
  setViewport(viewport: Viewport, options?: { duration?: number; ease?: (t: number) => number; interpolate?: "smooth" | "linear" }): Promise<boolean>;
}
/** The part of the canvas nothing covers (the stage, a rail), in the canvas element's own pixels. */
export interface Area { x0: number; y0: number; x1: number; y1: number }

/** The longest glide: a move within a screen, under Material's 450 ms for a large move, so it never drags. */
export const GLIDE_MAX = 400;
const GLIDE_MIN = 180;
/** A move past a screen: out and in, 100 ms each. */
export const FADE_MS = 200;
/** No follow move within this of the last move: about a pause in talk, so a burst of landings is one move. */
export const SPACING_MS = 2500;
/** Under Reduce Motion, how long the ring stays where the camera cut to. */
export const CUT_RING_MS = 1000;
/** Where the follow keeps your latest point: 55% down the free part of the screen, so what led to it shows above it and
 *  the next point has room below; it only moves once the point leaves the middle (8–92% across, 10–80% down). */
const AIM = 0.55;
const COMFORT = { left: 0.08, right: 0.92, top: 0.1, bottom: 0.8 };
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function useCamera(flow: Flow, area: () => Area, reduced: boolean, pane: () => HTMLElement | null) {
  /** When the camera last moved, and the follow's move waiting out its spacing. */
  const last = useRef(0);
  const waiting = useRef(0);
  const fade = useRef<Animation | null>(null);
  const [cut, setCut] = useState<string | null>(null);
  const cutTimer = useRef(0);
  useEffect(() => () => { window.clearTimeout(waiting.current); window.clearTimeout(cutTimer.current); fade.current?.cancel(); }, []);

  /** Past a screen: out, cut, in. */
  const crossFade = useCallback((next: Viewport) => {
    const element = pane();
    fade.current?.cancel();
    if (!element || typeof element.animate !== "function") { void flow.setViewport(next, { duration: 0 }); return; }
    const out = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS / 2, easing: "ease-in", fill: "forwards" });
    fade.current = out;
    let done = false;
    const cutHere = () => {
      if (done) return;
      done = true;
      void flow.setViewport(next, { duration: 0 });
      out.cancel();
      fade.current = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS / 2, easing: "ease-out" });
    };
    out.onfinish = cutHere;
    // A hidden tab runs no animation: the cut happens all the same.
    window.setTimeout(cutHere, FADE_MS / 2 + 40);
  }, [flow, pane]);

  /** A ring that stays a second on `key`: where the camera cut to, or what landed, in place of motion. */
  const flash = useCallback((key: string) => {
    window.clearTimeout(cutTimer.current);
    setCut(key);
    cutTimer.current = window.setTimeout(() => setCut(null), CUT_RING_MS);
  }, []);

  /** Goes to `next`: a glide within a screen, a cross-fade past it, a cut (and a ring on `ring`) under Reduce Motion. */
  const move = useCallback((next: Viewport, ring?: string) => {
    last.current = Date.now();
    const was = flow.getViewport();
    if (reduced) {
      void flow.setViewport(next, { duration: 0 });
      if (ring) flash(ring);
      return;
    }
    const a = area();
    const w = a.x1 - a.x0, h = a.y1 - a.y0;
    // How far what's in the middle of the view travels on screen.
    const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
    const fx = (cx - was.x) / was.zoom, fy = (cy - was.y) / was.zoom;
    const tx = fx * next.zoom + next.x - cx, ty = fy * next.zoom + next.y - cy;
    const zoomed = Math.abs(Math.log(next.zoom / was.zoom));
    if (zoomed < 0.05 && (Math.abs(tx) > w || Math.abs(ty) > h)) { crossFade(next); return; }
    const travel = Math.hypot(tx, ty) + zoomed * 400;
    void flow.setViewport(next, { duration: Math.round(Math.min(GLIDE_MAX, GLIDE_MIN + travel * 0.3)), ease, interpolate: "linear" });
  }, [flow, area, reduced, crossFade, flash]);

  /** Where `box` goes on screen: across the middle, `AIM` down the free part; at `zoom`, else reading size if far out. */
  const viewFor = useCallback((box: Box, zoom?: number): Viewport => {
    const a = area();
    const was = flow.getViewport();
    const z = zoom ?? (was.zoom < READ ? 1 : was.zoom);
    // A box taller than the free part shows its top: the tip, with its slot under it.
    const h = Math.min(box.h, (a.y1 - a.y0) * 0.6 / z);
    return { x: (a.x0 + a.x1) / 2 - (box.x + box.w / 2) * z, y: a.y0 + (a.y1 - a.y0) * AIM - (box.y + h / 2) * z, zoom: z };
  }, [flow, area]);

  /** Puts `box` where you'd look for it, at once (the opening frame) or as a move. */
  const aim = useCallback((box: Box, options: { zoom?: number; ring?: string; instant?: boolean } = {}) => {
    window.clearTimeout(waiting.current);
    const next = viewFor(box, options.zoom);
    if (options.instant) { last.current = Date.now(); void flow.setViewport(next, { duration: 0 }); return; }
    move(next, options.ring);
  }, [viewFor, move, flow]);

  /** Fits `box` with 32 px around it in the free part, between `least` and `most` zoom. */
  const fit = useCallback((box: Box, most = 1, least = 0.04, options: { instant?: boolean } = {}) => {
    window.clearTimeout(waiting.current);
    const a = area();
    const w = a.x1 - a.x0, h = a.y1 - a.y0;
    const zoom = Math.max(least, Math.min(most, (w - 64) / Math.max(box.w, 1), (h - 64) / Math.max(box.h, 1)));
    const next = { x: (a.x0 + a.x1) / 2 - (box.x + box.w / 2) * zoom, y: (a.y0 + a.y1) / 2 - (box.y + box.h / 2) * zoom, zoom };
    if (options.instant) { last.current = Date.now(); void flow.setViewport(next, { duration: 0 }); return; }
    move(next);
  }, [area, move, flow]);

  /** Whether `box` sits in the comfortable middle, at reading size. */
  const comfortable = useCallback((box: Box) => {
    const a = area();
    const w = a.x1 - a.x0, h = a.y1 - a.y0;
    const { x, y, zoom } = flow.getViewport();
    const sx = box.x * zoom + x - a.x0, sy = box.y * zoom + y - a.y0;
    return zoom >= READ && sx >= w * COMFORT.left && sx + box.w * zoom <= w * COMFORT.right && sy >= h * COMFORT.top && sy + Math.min(box.h * zoom, h * 0.3) <= h * COMFORT.bottom;
  }, [area, flow]);

  /** The follow: `target()` (asked when the move is due, so it's the latest) into the comfortable middle, if it left it;
   *  spaced at least SPACING_MS from the camera's last move. */
  const follow = useCallback((target: () => { box: Box; ring?: string } | null) => {
    window.clearTimeout(waiting.current);
    const run = () => {
      const goal = target();
      if (!goal || comfortable(goal.box)) return;
      const wait = last.current + SPACING_MS - Date.now();
      if (wait > 0) { waiting.current = window.setTimeout(run, wait); return; }
      move(viewFor(goal.box), goal.ring);
    };
    run();
  }, [comfortable, move, viewFor]);

  /** A hand on the map: whatever the follow had waiting doesn't happen. */
  const hold = useCallback(() => { window.clearTimeout(waiting.current); }, []);

  return { aim, fit, follow, hold, flash, comfortable, cut };
}
