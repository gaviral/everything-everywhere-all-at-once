// Popovers anchored to a button (the Room menu, the "?" list, a point's Move list) stay whole on screen, with a 16 px
// side gutter, at any width and wherever their button sits: CSS anchors each one to its button's right edge, and on a
// phone a button near the left pushed a 290 px panel past the screen's left edge.
//
// When a popover shows (a ResizeObserver on its contents: it reports after layout and before paint, so the first frame
// is already in place), and on resize while it shows: shift it sideways into view, and cap its height to the room below
// (or above, when it opens near the bottom of the screen and there is more room above), scrolling inside. The shift is
// a `translate`, never animated, so Reduce Motion has nothing to hold back; focus, keys and Esc are the popover's own.
import { useLayoutEffect, type RefObject } from "react";

/** The side and bottom margin every popover keeps from the screen's edge (px). */
export const GUTTER = 16;

/** The band of the screen a popover may use, top to bottom (px from the viewport's top). */
export type Edges = { top: number; bottom: number };
const SCREEN = (): Edges => ({ top: 0, bottom: window.innerHeight });

/** For a popover on the map: the band between what is drawn over the map, the header and the map tools above (sticky,
 *  or wherever they scrolled to) and the dock below (fixed). */
export function mapEdges(): Edges {
  const edge = (selector: string, side: "top" | "bottom") => document.querySelector(selector)?.getBoundingClientRect()[side];
  return {
    top: Math.max(0, edge("header", "bottom") ?? 0, edge(".map-tools", "bottom") ?? 0),
    bottom: Math.min(window.innerHeight, edge(".dock", "top") ?? Infinity),
  };
}

/** A popover's shift into view: `dx` sideways, `flip` (open above its button instead of below) and `fit`, the height it
 *  may take. `box` is where it lies unshifted (its own height `natural`); `anchor` is its button's row, `gap` the space
 *  CSS keeps between them; `width` the screen's, `edges` the band it may use. */
export function place(box: { left: number; right: number; top: number; natural: number }, anchor: { top: number; bottom: number } | null,
  gap: number, width: number, edges: Edges) {
  const dx = box.right - box.left > width - 2 * GUTTER ? GUTTER - box.left
    : box.left < GUTTER ? GUTTER - box.left
    : box.right > width - GUTTER ? width - GUTTER - box.right
    : 0;
  const below = edges.bottom - GUTTER - box.top;
  const above = anchor ? anchor.top - gap - GUTTER - edges.top : 0;
  // Above only when it doesn't fit below and above has more room: a header's popover always opens down.
  const flip = !!anchor && box.natural > below && above > below;
  return { dx, flip, fit: Math.max(0, Math.floor(flip ? above : below)) };
}

/** Keeps `el` on screen (within `edges`) while it shows; returns the cleanup. */
export function keepOnScreen(el: HTMLElement, edges: () => Edges = SCREEN): () => void {
  let dx = 0, dy = 0;
  // A <details> panel (the Room menu, the "?" list): its open attribute changes before the browser draws again, so a
  // MutationObserver (a microtask) places it ahead of the first frame. Closed, its contents still lay out when measured,
  // somewhere meaningless: never placed from that.
  const details = el.parentElement?.closest("details") ?? null;
  const update = () => {
    if (details && !details.open) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // not drawn: placed again when it shows
    const style = getComputedStyle(el);
    const absolute = style.position === "absolute";
    const parent = absolute ? el.offsetParent?.getBoundingClientRect() ?? null : null;
    // Where it would be unshifted: today's rect less the shift already applied.
    const left = rect.left - dx, top = rect.top - dy;
    const gap = parent ? top - parent.bottom : 0;
    const frame = el.offsetHeight - el.clientHeight; // borders: scrollHeight leaves them out
    const natural = el.scrollHeight + frame;
    const at = place({ left, right: left + rect.width, top, natural }, parent, gap, document.documentElement.clientWidth, edges());
    dx = at.dx > 0 ? Math.ceil(at.dx) : Math.floor(at.dx); // whole pixels, never short of the gutter
    dy = at.flip && parent ? Math.round(parent.top - gap - Math.min(natural, at.fit) - top) : 0;
    el.style.translate = dx || dy ? `${dx}px ${dy}px` : "";
    el.style.setProperty("--fit-height", `${at.fit}px`);
  };
  // Its contents, not the popover itself: they go from nothing to their size when it shows and change as it fills, but
  // not when the height cap below takes effect, which would re-trigger the observer within its own frame.
  const observer = new ResizeObserver(update);
  for (const child of el.children) observer.observe(child);
  const opening = new MutationObserver(update);
  if (details) opening.observe(details, { attributes: true, attributeFilter: ["open"] });
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  update();
  return () => {
    observer.disconnect();
    opening.disconnect();
    window.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("resize", update);
  };
}

/** `keepOnScreen` for a popover React renders: from its first layout, before the first paint. `rendered`: whether the
 *  component draws it now (one that returns null at times). */
export function useOnScreen(ref: RefObject<HTMLElement | null>, { rendered = true, edges = SCREEN }: { rendered?: boolean; edges?: () => Edges } = {}) {
  useLayoutEffect(() => (rendered && ref.current ? keepOnScreen(ref.current, edges) : undefined), [ref, rendered, edges]);
}
