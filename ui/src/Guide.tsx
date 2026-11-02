// Another participant (an AI joined with a name, e.g. Claude over the bridge) shows you one exact part of the screen:
// a big arrow at it, its caption beside it and a soft spotlight, one at a time; and says what it says as a caption in
// the corner, instead of as cards on your map. The core relays both (core/src/guide.rs); the names are each part's
// `data-guide` (docs/guide.md); the rules are guide-core.ts's, held by scripts/guide-check.mjs.
//  - A point scrolls its part into view and follows it as it moves. Esc or a click takes it down, except a click on what
//    the arrow shows the way through (a folded card's Show, the Map button): the arrow then goes on to the part itself.
//  - A part that isn't on screen isn't guessed at: the arrow shows what reveals it, and its caption says where it is;
//    with no such rule, no arrow, and the caption says it isn't on screen.
//  - Both draw in the top layer (a manual popover), so they show over an open sheet too, and take no clicks.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "motion/react";
import type { World } from "./core";
import { aimAt, arrowLength, captionMs, captionRead, dismissPoint, GUTTER, HOLE_PAD, instead, label, place, useGuide, type Said, type Shown, type Where } from "./guide-core";
import "./guide.css";

type Props = { world: World; view: string; query: string; focus: boolean };

export function Guide(props: Props) {
  const { point, caption } = useGuide();
  // What a screen reader hears, set once per message (a region whose words change on their own would say them again).
  const [pointSaid, setPointSaid] = useState("");
  const [captionSaid, setCaptionSaid] = useState("");
  useEffect(() => { if (caption) setCaptionSaid(`${caption.by}: ${caption.text}`); }, [caption?.n]);
  return <>
    {point && <Pointer key={point.n} shown={point} {...props} say={setPointSaid} />}
    {caption && <Caption key={caption.n} said={caption} raise={point?.n ?? 0} />}
    <div className="sr-only" role="status">{pointSaid}</div>
    <div className="sr-only" role="status">{captionSaid}</div>
  </>;
}

/** The visible part named `name`, if any: the first of its elements that's drawn (one leaving can linger as it fades). */
function find(name: string): HTMLElement | null {
  const drawn = (el: HTMLElement) => el.getClientRects().length > 0
    && (typeof el.checkVisibility !== "function" || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  for (const el of document.querySelectorAll<HTMLElement>(`[data-guide="${CSS.escape(name)}"]`)) if (drawn(el)) return el;
  // A thought said across a pause shows inside the point it carries on into (chunks.tsx), which lists it as a head.
  if (name.startsWith("point:")) {
    const id = name.slice(6);
    for (const li of document.querySelectorAll<HTMLElement>("li[data-heads]")) if (li.dataset.heads!.split(" ").includes(id) && drawn(li)) return li;
  }
  // In a view brick, a thread is what it marks `data-thread` (bricks/contract.ts: what "this" means there too): its
  // topmost, as a spine's head sits above its points.
  if (name.startsWith("thread:")) {
    const marked = [...document.querySelectorAll<HTMLElement>(`[data-thread="${CSS.escape(name.slice(7))}"]`)].filter(drawn);
    return marked.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] ?? null;
  }
  return null;
}

/** Parts drawn over the page (the header, the map's tools, the notices, the dock, a sheet): always on screen. */
const FLOATING = "header, .map-tools, .notice-lane, .dock, dialog, .explain";

/** Where `el` can be seen: anywhere, if it floats; else under the header, and under the map's tools if it comes after
 *  them (the map scrolls under them; the Apps panel above them doesn't), and above the dock (as onscreen.ts `mapEdges`). */
function bandFor(el: Element): { top: number; bottom: number } {
  const height = window.innerHeight;
  if (el.closest(FLOATING)) return { top: 0, bottom: height };
  const edge = (selector: string, side: "top" | "bottom") => document.querySelector(selector)?.getBoundingClientRect()[side];
  const tools = document.querySelector(".map-tools");
  const under = !!tools && !!(tools.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  return {
    top: Math.max(0, edge("header", "bottom") ?? 0, under ? edge(".map-tools", "bottom") ?? 0 : 0),
    bottom: Math.min(height, edge(".dock", "top") ?? height),
  };
}

/** Puts `el` where it can be seen: a part of the page between what floats over it (its middle, or its head when it's
 *  taller than that room), a part in a floating panel that scrolls by itself into view there. */
function bringIntoView(el: HTMLElement, instant: boolean) {
  const behavior: ScrollBehavior = instant ? "instant" : "smooth";
  if (el.closest(FLOATING)) { el.scrollIntoView({ block: "nearest", inline: "nearest", behavior }); return; }
  const band = bandFor(el), box = el.getBoundingClientRect(), room = band.bottom - band.top;
  if (box.top >= band.top && box.bottom <= band.bottom) return;
  const by = box.height > room - 2 * GUTTER ? box.top - band.top - GUTTER : (box.top + box.bottom) / 2 - (band.top + band.bottom) / 2;
  window.scrollBy({ top: by, behavior });
}

/** The arrow's drawing, pointing right with its tip at 0,0 (the frame loop turns and moves it): a shaft, then a head. */
const HEAD = 20, HALF = 12;
const shaft = (length: number) => `M ${-length} 0 L ${-HEAD + 2} 0`;
const head = `M 0 0 L ${-HEAD} ${-HALF} L ${-HEAD} ${HALF} Z`;
const TURN = { above: 90, below: -90, left: 0, right: 180 } as const;

function Pointer({ shown, world, view, query, focus, say }: Props & { shown: Shown; say: (words: string) => void }) {
  const reduced = !!useReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGGElement>(null);
  const shafts = useRef<SVGPathElement[]>([]);
  const box = useRef<HTMLDivElement>(null);
  // What the arrow aims at (null: no arrow), and the line that says where the part is when it's not the part itself.
  const [aim, setAim] = useState<{ name: string | null; line: string }>({ name: null, line: "" });
  const aimNow = useRef(aim);
  const aimed = useRef<{ el: HTMLElement | null; via: boolean }>({ el: null, via: false });
  const where = useRef<Where>(null!);
  where.current = {
    map: world, view, query, focus, shown: (name) => !!find(name),
    folded: (id) => !!find(`thread:${id}`)?.classList.contains("collapsed"),
  };

  useLayoutEffect(() => {
    const top = layer.current;
    // Last into the top layer: over a sheet that's open, as the caption of what you're shown should be.
    try { top?.showPopover?.(); } catch { /* shown already, or no popovers here: it's fixed over the page */ }
    let frame = 0;
    let seenName: string | null | undefined;
    let last = "";
    const tick = () => {
      const asked = find(shown.target);
      const how = asked ? { via: null, line: "" } : instead(shown.target, where.current);
      const el = asked ?? (how.via ? find(how.via) : null);
      const name = asked ? shown.target : el ? how.via : null;
      aimed.current = { el, via: !asked && !!el };
      if (name !== seenName) {
        // A newly aimed part comes into view once; after that, where you scroll is yours.
        if (el) bringIntoView(el, reduced);
        seenName = name;
      }
      if (name !== aimNow.current.name || how.line !== aimNow.current.line || frame === 0) {
        aimNow.current = { name, line: how.line };
        setAim(aimNow.current);
        // Who points at what, and where it is when that's not the part itself: the arrow, in words.
        const what = label(name ?? shown.target, where.current.map);
        say(`${shown.by} points at ${what}${shown.text ? `: ${shown.text}` : "."}${how.line ? ` ${how.line}` : ""}`);
      }
      const state = position(el);
      if (state !== last && top) { top.dataset.state = state; last = state; }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [shown.n]);

  // The part, the arrow and the caption, where they are now. Returns "aimed", "past" (the part is scrolled away: the
  // arrow points at the edge it's past) or "alone" (no arrow).
  const position = (el: HTMLElement | null): string => {
    const card = box.current, g = arrow.current, spot = hole.current;
    if (!card || !g || !spot) return "";
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    if (!el) {
      // Said alone, in the middle, under what floats at the top of the map.
      const top = Math.max(document.querySelector("header")?.getBoundingClientRect().bottom ?? 0, document.querySelector(".map-tools")?.getBoundingClientRect().bottom ?? 0);
      card.style.translate = `${Math.round(Math.max(GUTTER, (width - size.width) / 2))}px ${Math.round(Math.max(GUTTER, top + 12))}px`;
      return "alone";
    }
    const band = bandFor(el);
    const { box: part, seen } = aimAt(el.getBoundingClientRect(), { ...band, width });
    const length = arrowLength(width);
    // The page's parts keep the arrow and its caption on the page, clear of the dock; a floating part may use it all.
    const placed = place(part, { width, height, ...band }, size, length);
    card.style.translate = `${Math.round(placed.caption.left)}px ${Math.round(placed.caption.top)}px`;
    g.setAttribute("transform", `translate(${placed.tip.x.toFixed(1)} ${placed.tip.y.toFixed(1)}) rotate(${TURN[placed.side]})`);
    for (const path of shafts.current) path.setAttribute("d", shaft(length));
    if (seen) {
      spot.style.translate = `${Math.round(part.left - HOLE_PAD)}px ${Math.round(part.top - HOLE_PAD)}px`;
      spot.style.width = `${Math.round(part.right - part.left + 2 * HOLE_PAD)}px`;
      spot.style.height = `${Math.round(part.bottom - part.top + 2 * HOLE_PAD)}px`;
    }
    return seen ? "aimed" : "past";
  };
  // Again once the caption's words change (its size with them), before that frame is drawn.
  useLayoutEffect(() => { position(aimed.current.el); }, [aim]);

  // Esc or a click takes it down. A click on what the arrow shows the way through is that way: it stays and moves on.
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (aimed.current.via && aimed.current.el?.contains(event.target as Node)) return;
      dismissPoint();
    };
    // As a tip's Esc (Tips.tsx): the point's only, unless typed in a field, which keeps it too.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissPoint();
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
      if (!typing) event.stopPropagation();
    };
    document.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  return createPortal(<div ref={layer} className="guide-layer" popover="manual" aria-hidden="true" data-state="">
    <div ref={hole} className="guide-hole" />
    <svg className="guide-arrow" width="100%" height="100%">
      <g ref={arrow}>
        {/* Again from where it starts each time it's aimed somewhere new: the eye follows a short move to the part. */}
        <g key={aim.name ?? ""} className="guide-arrow-move">
          <path ref={(el) => { if (el) shafts.current[0] = el; }} className="guide-arrow-halo" d={shaft(72)} />
          <path className="guide-arrow-halo" d={head} />
          <path ref={(el) => { if (el) shafts.current[1] = el; }} className="guide-arrow-line" d={shaft(72)} />
          <path className="guide-arrow-head" d={head} />
        </g>
      </g>
    </svg>
    <div ref={box} className="guide-tip">
      <span className="guide-by">{shown.by}</span>
      {shown.text && <span className="guide-text">{shown.text}</span>}
      {aim.line && <span className="guide-where">{aim.line}</span>}
    </div>
  </div>, document.body);
}

/** The bottom-left corner, clear of the composer: beside the dock where the screen leaves room (a laptop), else above it. */
const SIDE_ROOM = 220;
/** The least a caption stays once the pointer leaves it or the page shows again: time to look back at it. */
const MOMENT = 1500;
function Caption({ said, raise }: { said: Said; raise: number }) {
  const reduced = !!useReducedMotion();
  const card = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  // Shown once: lifted over a point that comes after it (what's said is never under the spotlight's shade), it doesn't
  // fade in again.
  const [settled, setSettled] = useState(false);
  const raised = useRef(raise);
  useLayoutEffect(() => {
    const el = card.current;
    if (raise === raised.current || !el?.matches(":popover-open")) return;
    raised.current = raise;
    try { el.hidePopover(); el.showPopover(); } catch { /* no popovers here */ }
  }, [raise]);
  // Its reading time runs only while the page shows (a caption is no longer on the map to find later): hidden (you're
  // in another window), it waits. The pointer on it holds it from going, its time still running (that's reading it);
  // off it, it has at least a moment more.
  const left = useRef(captionMs(said.text)); // the time still owed as of `since`
  const since = useRef(0); // when the page last showed; 0 while hidden
  const over = useRef(false);
  const timer = useRef(0);
  const owed = () => left.current - (since.current ? Date.now() - since.current : 0);
  const arm = () => {
    window.clearTimeout(timer.current);
    if (since.current && !over.current) timer.current = window.setTimeout(() => setLeaving(true), Math.max(0, owed()));
  };
  const atLeast = (ms: number) => { if (owed() < ms) left.current = ms + (since.current ? Date.now() - since.current : 0); };

  useLayoutEffect(() => {
    const el = card.current;
    try { el?.showPopover?.(); } catch { /* as the point's */ }
    let frame = 0;
    const tick = () => {
      if (el) {
        const width = document.documentElement.clientWidth, height = window.innerHeight;
        const composer = document.querySelector('[data-guide="composer"]')?.getBoundingClientRect();
        const dock = document.querySelector(".dock-inner")?.getBoundingClientRect();
        const side = dock ? dock.left - 2 * GUTTER : 0;
        const beside = !!composer && side >= SIDE_ROOM;
        el.style.maxWidth = `${Math.floor(beside ? Math.min(360, side) : Math.min(360, width - 2 * GUTTER))}px`;
        // Its foot level with the composer's beside the dock; else over the dock's top, or the screen's foot.
        const rest = beside ? composer!.bottom : (dock?.top ?? composer?.top ?? height) - 8;
        // Clear of a point's arrow and its caption where they meet (a phone, a part near the corner): over them.
        const marks = [".guide-layer:not([data-state='alone']) .guide-arrow > g", ".guide-tip"]
          .map((selector) => document.querySelector(selector)?.getBoundingClientRect()).filter((r) => r && r.width > 0) as DOMRect[];
        let foot = rest;
        for (let i = 0; i < marks.length; i++) {
          const top = foot - el.offsetHeight, right = GUTTER + el.offsetWidth;
          const hit = marks.find((r) => GUTTER < r.right + 8 && r.left - 8 < right && top < r.bottom + 8 && r.top - 8 < foot);
          if (!hit) break;
          foot = hit.top - 8;
        }
        if (foot - el.offsetHeight < GUTTER) foot = rest;
        el.style.bottom = `${Math.round(Math.max(GUTTER, height - foot))}px`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const seen = () => {
      if (document.hidden) { left.current = owed(); since.current = 0; }
      else if (!since.current) { since.current = Date.now(); atLeast(MOMENT); }
      arm();
    };
    seen();
    document.addEventListener("visibilitychange", seen);
    return () => { window.clearTimeout(timer.current); document.removeEventListener("visibilitychange", seen); };
  }, []);
  // Faded out: gone. Without motion it goes at once.
  useEffect(() => {
    if (!leaving) return;
    const gone = window.setTimeout(() => captionRead(said.n), reduced ? 0 : 400);
    return () => window.clearTimeout(gone);
  }, [leaving]);

  // The pointer on it holds it while you read; off it, it stays its time out, and at least a moment more.
  return createPortal(<div ref={card} className={["guide-caption", settled ? "settled" : "", leaving ? "leaving" : ""].filter(Boolean).join(" ")} popover="manual" aria-hidden="true"
    onAnimationEnd={() => setSettled(true)}
    onPointerEnter={() => { over.current = true; arm(); setLeaving(false); }}
    onPointerLeave={() => { over.current = false; atLeast(MOMENT); arm(); }}>
    <span className="guide-by">{said.by}</span>
    <span className="guide-text">{said.text}</span>
  </div>, document.body);
}
