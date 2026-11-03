// The Friend's face (docs/guide.md): what another participant on the map (an AI joined with a name, e.g. the Friend
// over its bridge) shows you and says, and the questions it holds for your pause. The core relays them
// (core/src/guide.rs); the rules are guide-core.ts's, held by scripts/guide-check.mjs.
//  - The caption, bottom center, just above where you type: its name first (✦ and purple for an AI's), Markdown as
//    the map shows it, two lines at a time, page by page, each up for its reading time; the pointer on it holds it.
//    Said while you talk or type, it waits for your pause. Talk over it and it steps back at once: what you didn't get
//    to read waits in the held stack (Continue).
//  - A point: one arrow from the caption to the named part, a ring round the part; the part scrolled into view and
//    followed as it moves. Esc or a click takes it down, except a click on what the arrow shows the way through (a
//    folded card's Show, the Map button): the arrow then goes on to the part itself. A part that isn't on screen isn't
//    guessed at: the arrow shows what reveals it, and the caption says where it is; with no such rule, no arrow.
//  - A held question waits in the held stack (data-slot="held" once the page has one; till then bottom right, a chip on
//    a phone) while you talk or type, and is asked at your next pause: its caption with Go ahead ↵ · Later L · Drop it
//    esc and an arrow at what it's about. Talking over it before you could read it puts it back; after, answers it.
//  - The caption and the arrow draw in the top layer (manual popovers), over an open sheet too.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "motion/react";
import type { BrickOn } from "./bricks/contract";
import type { World } from "./core";
import { Markdown } from "./md";
import {
  aimAt, askAtPause, askMs, askNow, busy, captionMs, captionRead, current, dismissPoint, dropHeld, dropIt, echoOf, goAhead, GUTTER, heard,
  instead, label, later, laterHeld, mainWords, NATURAL_PAUSE_MS, nextAsk, overMs, pages, pauseIn, plain, RING_PAD, route, stepBack,
  useGuide, useWindowOn, watchGuide, type Held, type Said, type Shown, type Where,
} from "./guide-core";
import "./guide.css";

type Props = { world: World; view: string; query: string; focus: boolean };

export function Guide(props: Props) {
  const { point, caption, held } = useGuide();
  const on = useWindowOn();
  const ai = (name: string) => !!props.world.ai?.includes(name);
  usePauses(on);
  useKeys();
  // What a screen reader hears, set once per message (a region whose words change on their own would say them again).
  const [pointSaid, setPointSaid] = useState("");
  const [captionSaid, setCaptionSaid] = useState("");
  const [heldSaid, setHeldSaid] = useState("");
  useEffect(() => {
    if (caption) setCaptionSaid(caption.ask ? `${caption.by} asks: ${plain(caption.text)} Go ahead, Later, or Drop it.` : `${caption.by}: ${plain(caption.text)}`);
  }, [caption?.n, !!caption?.ask]);
  const newest = held.reduce<Held | null>((a, b) => (!a || b.n > a.n ? b : a), null);
  useEffect(() => { if (newest?.state === "waiting") setHeldSaid(`${newest.by} holds this for your pause: ${plain(newest.text)}`); }, [newest?.n]);
  // Where the pointed-at part is, when the arrow shows the way to it instead: said in the caption.
  const [where, setWhere] = useState("");
  return <>
    {point && <Arrow key={point.n} shown={point} ink={ai(point.by)} {...props} say={setPointSaid} where={setWhere} />}
    {(caption || point) && <Line key={caption ? `c${caption.n}` : `p${point!.n}`} said={caption} point={point} where={point ? where : ""}
      ai={ai(caption?.by ?? point!.by)} raise={point?.n ?? 0} on={on} />}
    {held.length > 0 && <HeldStack held={held} ai={ai} />}
    <div className="sr-only" role="status">{pointSaid}</div>
    <div className="sr-only" role="status">{captionSaid}</div>
    <div className="sr-only" role="status">{heldSaid}</div>
  </>;
}

/** Your pauses: the first held question waiting for one is asked once you've been quiet for a natural pause
 *  (legible.ts NATURAL_PAUSE_MS) with nothing typed half-way in the box, no sheet open and the page in view. Your words
 *  (the window's `on("words")`, as bricks hear them), typing and coming back to the page restart it. */
function usePauses(on: BrickOn | null) {
  useEffect(() => {
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      if (document.hidden || !nextAsk(current())) return;
      const draft = !!document.querySelector<HTMLTextAreaElement>('[data-guide="composer"] textarea')?.value.trim();
      const wait = draft || document.querySelector("dialog[open]") ? NATURAL_PAUSE_MS : pauseIn();
      // Talking: the end of the turn checks again.
      if (wait === Infinity) return;
      if (wait > 0) { timer = window.setTimeout(check, wait); return; }
      askAtPause();
    };
    const typing = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")) { busy(); check(); }
    };
    const shown = () => { if (!document.hidden) busy(); check(); };
    const offWords = on?.("words", (words) => { heard(words); check(); });
    const offState = watchGuide(check);
    document.addEventListener("input", typing, true);
    document.addEventListener("visibilitychange", shown);
    check();
    return () => {
      window.clearTimeout(timer);
      offWords?.();
      offState();
      document.removeEventListener("input", typing, true);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [on]);
}

const inField = (target: EventTarget | null) => target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]");
const onPage = (target: EventTarget | null) => !target || target === document.body || target === document.documentElement;
/** The composer with nothing typed: its Enter has nothing to send, so it can answer the question asked. */
const emptyComposer = (target: EventTarget | null) => target instanceof HTMLTextAreaElement && !!target.closest('[data-guide="composer"]') && !target.value.trim();

/** The keys on the caption's buttons: while a question is asked, ↵ Go ahead (from the page or an empty composer), L
 *  Later (outside a field) and Esc Drop it; else Esc takes the point down, and a question's arrow with its caption.
 *  Esc typed in a field keeps its own meaning there too (as a tip's, Tips.tsx). */
function useKeys() {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { caption, point } = current();
      const asked = caption?.ask ? caption : null;
      if (event.key === "Escape") {
        if (asked) dropIt(asked.n);
        else if (point?.of) captionRead(point.of);
        else if (point) dismissPoint();
        else return;
        if (!inField(event.target)) event.stopPropagation();
        return;
      }
      if (!asked || event.repeat) return;
      if (event.key === "Enter" && !event.shiftKey && (onPage(event.target) || emptyComposer(event.target))) goAhead(asked.n);
      else if (event.key.toLowerCase() === "l" && !event.shiftKey && !inField(event.target)) later(asked.n);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
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

/** The page's regions over the map, by their contract names (bricks/contract.ts `SLOTS`: the new shell's corners, stage,
 *  status line, rail, shelf and held stack), then today's (the header, the map's tools, the notices, the dock, a sheet),
 *  and the guide's own held stack: a part in one is always on screen. */
const SLOTTED = ["top-left", "top-right", "bottom-left", "bottom-right", "stage", "status", "rail", "shelf", "held"].map((name) => `[data-slot="${name}"]`);
const FLOATING = [...SLOTTED, "header", ".map-tools", ".notice-lane", ".dock", "dialog", ".explain", ".guide-held"].join(", ");

/** An element's box while it's drawn. */
function drawnBox(selector: string): DOMRect | null {
  const r = document.querySelector(selector)?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? r : null;
}

/** Where `el` can be seen: anywhere, if it floats; else under what covers the map's top (today's header, and the map's
 *  tools if it comes after them, as the map scrolls under them; the new shell's top corners) and above what covers its
 *  foot (the stage or today's dock, the status line, and the caption itself), as onscreen.ts `mapEdges`. */
function bandFor(el: Element): { top: number; bottom: number } {
  const height = window.innerHeight;
  if (el.closest(FLOATING)) return { top: 0, bottom: height };
  const tools = document.querySelector(".map-tools");
  const under = !!tools && !!(tools.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const status = drawnBox('[data-slot="status"]');
  const tops = [drawnBox("header")?.bottom, under ? drawnBox(".map-tools")?.bottom : 0, drawnBox('[data-slot="top-left"]')?.bottom, drawnBox('[data-slot="top-right"]')?.bottom];
  const bottoms = [drawnBox('[data-slot="stage"]')?.top, drawnBox(".dock")?.top, status && status.top > height / 2 ? status.top : undefined, drawnBox(".guide-caption")?.top];
  const known = (values: (number | undefined)[]) => values.filter((value): value is number => typeof value === "number");
  return { top: Math.max(0, ...known(tops)), bottom: Math.min(height, ...known(bottoms)) };
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

/** The arrowhead, pointing right with its tip at 0,0 (turned and moved to the arrow's end each frame). */
const head = (size: number) => `M 0 0 L ${-size} ${-size * 0.6} L ${-size} ${size * 0.6} Z`;

function Arrow({ shown, ink, world, view, query, focus, say, where }: Props & { shown: Shown; ink: boolean; say: (words: string) => void; where: (line: string) => void }) {
  const reduced = !!useReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const halo = useRef<SVGPathElement>(null);
  const line = useRef<SVGPathElement>(null);
  const tip = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  // What the arrow aims at (null: no arrow), and the line that says where the part is when it's not the part itself.
  const [aim, setAim] = useState<{ name: string | null; line: string }>({ name: null, line: "" });
  const aimNow = useRef(aim);
  const aimed = useRef<{ el: HTMLElement | null; via: boolean }>({ el: null, via: false });
  const at = useRef<Where>(null!);
  at.current = {
    map: world, view, query, focus, shown: (name) => !!find(name),
    folded: (id) => !!find(`thread:${id}`)?.classList.contains("collapsed"),
  };

  useLayoutEffect(() => {
    const top = layer.current;
    // Last into the top layer: over a sheet that's open, as what you're shown should be.
    try { top?.showPopover?.(); } catch { /* shown already, or no popovers here: it's fixed over the page */ }
    let frame = 0;
    let seenName: string | null | undefined;
    let last = "";
    const tick = () => {
      const asked = find(shown.target);
      const how = asked ? { via: null, line: "" } : instead(shown.target, at.current);
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
        where(how.line);
        // Who points at what, and where it is when that's not the part itself: the arrow, in words.
        const what = label(name ?? shown.target, at.current.map);
        say(`${shown.by} points at ${what}${shown.text ? `: ${plain(shown.text)}` : "."}${how.line ? ` ${how.line}` : ""}`);
      }
      const state = position(el);
      if (state !== last && top) { top.dataset.state = state; last = state; }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(frame); where(""); };
  }, [shown.n]);

  // The part, its ring and the arrow from the caption to it, where they are now. Returns "aimed", "past" (the part is
  // scrolled away: the arrow points at the edge it's past), "near" (the caption is at it already: the ring alone) or
  // "alone" (nothing to aim at, or no caption yet: neither).
  const position = (el: HTMLElement | null): string => {
    const from = drawnBox(".guide-caption");
    if (!el || !from || !ring.current || !line.current) return "alone";
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    const band = bandFor(el);
    const { box: part, seen } = aimAt(el.getBoundingClientRect(), { ...band, width });
    if (seen) {
      const spot = ring.current;
      spot.style.translate = `${Math.round(part.left - RING_PAD)}px ${Math.round(part.top - RING_PAD)}px`;
      spot.style.width = `${Math.round(part.right - part.left + 2 * RING_PAD)}px`;
      spot.style.height = `${Math.round(part.bottom - part.top + 2 * RING_PAD)}px`;
    }
    const path = route(from, part, { width, height, ...(el.closest(FLOATING) ? {} : band) });
    if (!path) return seen ? "near" : "alone";
    const f = (n: number) => n.toFixed(1);
    const d = `M ${f(path.start.x)} ${f(path.start.y)} C ${f(path.c1.x)} ${f(path.c1.y)} ${f(path.c2.x)} ${f(path.c2.y)} ${f(path.end.x)} ${f(path.end.y)}`;
    halo.current?.setAttribute("d", d);
    line.current.setAttribute("d", d);
    const turn = (Math.atan2(path.end.y - path.c2.y, path.end.x - path.c2.x) * 180) / Math.PI;
    tip.current?.setAttribute("transform", `translate(${f(path.end.x)} ${f(path.end.y)}) rotate(${turn.toFixed(1)})`);
    tip.current?.setAttribute("data-side", path.side);
    dot.current?.setAttribute("cx", f(path.start.x));
    dot.current?.setAttribute("cy", f(path.start.y));
    return seen ? "aimed" : "past";
  };
  // Again once the words change (the caption's size with them), before that frame is drawn.
  useLayoutEffect(() => { position(aimed.current.el); }, [aim]);

  // A click takes it down, but not one on the caption or the held stack (their own buttons), nor on what the arrow shows
  // the way through: that's the way, so it stays and moves on. A question's arrow goes with its caption.
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".guide-caption, .guide-held")) return;
      if (aimed.current.via && aimed.current.el?.contains(target)) return;
      dismissPoint();
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);

  const size = typeof window !== "undefined" && window.innerWidth < 560 ? 13 : 16;
  return createPortal(<div ref={layer} className="guide-layer" data-ai={ink || undefined} popover="manual" aria-hidden="true" data-state="">
    <div ref={ring} className="guide-ring" />
    <svg className="guide-arrow" width="100%" height="100%">
      {/* Drawn again from the caption each time it's aimed somewhere new: the eye follows the line to the part. */}
      <g key={aim.name ?? ""} className="guide-arrow-move">
        <path ref={halo} className="guide-arrow-halo" pathLength={1} />
        <path ref={line} className="guide-arrow-line" pathLength={1} />
        <path ref={tip} className="guide-arrow-head" d={head(size)} />
        <circle ref={dot} className="guide-arrow-dot" r={3.5} />
      </g>
    </svg>
  </div>, document.body);
}

/** Between the caption and what it sits on (the stage, the dock, the composer). */
const CAPTION_GAP = 10;
/** The least a caption stays once the pointer leaves it or the page shows again: time to look back at it. */
const MOMENT = 1500;
/** Stepping back when talked over: as quick as a press (ux-revamp §3: press 120 ms). */
const STEP_MS = 120;

/** Where the caption goes: centered over the stage (the new shell's bottom center) and just above it, else over
 *  today's dock column, clear of everything in it; else the screen's foot. */
function stageSpot(): { x: number; foot: number } {
  const width = document.documentElement.clientWidth, height = window.innerHeight;
  const stage = drawnBox('[data-slot="stage"]');
  if (stage) return { x: (stage.left + stage.right) / 2, foot: stage.top - CAPTION_GAP };
  const composer = drawnBox('[data-guide="composer"]'), column = drawnBox(".dock-inner");
  const center = composer ?? column;
  if (center) return { x: (center.left + center.right) / 2, foot: Math.min(column?.top ?? Infinity, composer?.top ?? Infinity) - CAPTION_GAP };
  const status = drawnBox('[data-slot="status"]');
  return { x: width / 2, foot: (status && status.top > height / 2 ? status.top : height) - GUTTER };
}

/** A clock that runs only while the page shows (what's said isn't on the map to find later): the pointer on the
 *  caption keeps it from ending, its time still running (that's reading it); off it, at least a moment more. */
function useReadingClock(done: () => void) {
  const left = useRef(0); // the time still owed as of `since`
  const since = useRef(0); // when the page last showed; 0 while hidden
  const over = useRef(false);
  const running = useRef(false);
  const timer = useRef(0);
  const latest = useRef(done);
  latest.current = done;
  const owed = () => left.current - (since.current ? Date.now() - since.current : 0);
  const arm = () => {
    window.clearTimeout(timer.current);
    if (!running.current || !since.current || over.current) return;
    timer.current = window.setTimeout(() => { running.current = false; latest.current(); }, Math.max(0, owed()));
  };
  const owe = (ms: number) => { left.current = ms; since.current = document.hidden ? 0 : Date.now(); };
  useEffect(() => {
    const seen = () => {
      if (!running.current) return;
      if (document.hidden) { left.current = owed(); since.current = 0; } else if (!since.current) owe(Math.max(left.current, MOMENT));
      arm();
    };
    document.addEventListener("visibilitychange", seen);
    return () => { window.clearTimeout(timer.current); document.removeEventListener("visibilitychange", seen); };
  }, []);
  return useRef({
    start(ms: number) { running.current = true; owe(ms); arm(); },
    hold(on: boolean) {
      over.current = on;
      if (on) window.clearTimeout(timer.current);
      else if (running.current) { owe(Math.max(owed(), MOMENT)); arm(); }
    },
    stop() { running.current = false; window.clearTimeout(timer.current); },
  }).current;
}

/** The caption at the stage: what's said now, or the point's own words while it's up alone; the arrow comes from it. */
function Line({ said, point, where, ai, raise, on }: { said: Said | null; point: Shown | null; where: string; ai: boolean; raise: number; on: BrickOn | null }) {
  const reduced = !!useReducedMotion();
  const card = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const by = said?.by ?? point?.by ?? "";
  const text = said?.text ?? point?.text ?? "";
  const asking = !!said?.ask;
  const [list, setList] = useState<string[]>([text]);
  const [page, setPage] = useState(0);
  const [leaving, setLeaving] = useState<"" | "read" | "back">("");
  const [settled, setSettled] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const now = useRef({ list, page, shown: Date.now(), leaving: false });
  now.current.list = list;
  now.current.page = page;

  // Shown once: lifted over a point that comes after it (what's said is never under the arrow's layer), it doesn't
  // fade in again.
  const raised = useRef(raise);
  useLayoutEffect(() => {
    const el = card.current;
    if (raise === raised.current || !el?.matches(":popover-open")) return;
    raised.current = raise;
    try { el.hidePopover(); el.showPopover(); } catch { /* no popovers here */ }
  }, [raise]);

  // Bottom center, just above the stage: every frame (the dock grows and shrinks, a phone's keyboard comes and goes),
  // and after each render before it's drawn (its words, and their size, change with it).
  const place = () => {
    const el = card.current;
    if (!el) return;
    const width = document.documentElement.clientWidth;
    const { x, foot } = stageSpot();
    const left = Math.min(Math.max(GUTTER, x - el.offsetWidth / 2), width - GUTTER - el.offsetWidth);
    el.style.translate = `${Math.round(left)}px ${Math.round(Math.max(GUTTER, foot - el.offsetHeight))}px`;
  };
  useLayoutEffect(place);
  useLayoutEffect(() => {
    try { card.current?.showPopover?.(); } catch { /* as the arrow's */ }
    let frame = 0;
    const tick = () => {
      place();
      const mic = !!document.querySelector('[data-guide="mic"][aria-pressed="true"]');
      setMicOn((was) => (was === mic ? was : mic));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  // Two lines at a time: measured once, in the caption's own font and width (a question asked is one page: it's held
  // short, guide.rs HOLD_MAX; so is a point's own line).
  useLayoutEffect(() => {
    const el = words.current, box = card.current;
    if (!said || asking || !el || !box) return;
    const style = getComputedStyle(el), boxStyle = getComputedStyle(box);
    const pen = document.createElement("canvas").getContext("2d");
    if (!pen) return;
    pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const room = (parseFloat(boxStyle.maxWidth) || box.offsetWidth) - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight) - 2;
    // The name, its margin and the space after it come first on page one's first line.
    const lead = (name.current?.offsetWidth ?? 0) + parseFloat(getComputedStyle(name.current ?? el).marginRight || "0") + pen.measureText(" ").width;
    setList(pages(text, room, (run) => pen.measureText(run).width, lead));
  }, [said?.n]);

  const clock = useReadingClock(() => {
    if (!said) return;
    // Unanswered: back to the stack, to wait for you.
    if (said.ask) { later(said.n); return; }
    if (now.current.page < now.current.list.length - 1) { setPage((p) => p + 1); return; }
    setLeaving("read");
  });
  // Each page its reading time; a question asked, the time to read it, look and decide; gone ahead, its reading time.
  useEffect(() => {
    if (!said) return;
    now.current.shown = Date.now();
    clock.start(said.ask ? askMs(said.text) : captionMs(list[page] ?? said.text));
  }, [said?.n, asking, page, list]);

  // Faded out: gone. Without motion it goes at once.
  useEffect(() => {
    if (leaving !== "read" || !said) return;
    const gone = window.setTimeout(() => captionRead(said.n), reduced ? 0 : 400);
    return () => window.clearTimeout(gone);
  }, [leaving]);

  // Talked over: your words while it's up (not its own voice coming back through the mic) and it steps back at once.
  // What you didn't get to read (this page too, if you spoke before you could have) waits in the held stack.
  useEffect(() => {
    if (!on || !said) return;
    return on("words", (heardNow) => {
      if (!heardNow.trim() || now.current.leaving || echoOf(heardNow, said.text)) return;
      const { list: shownList, page: at, shown } = now.current;
      const early = Date.now() - shown < overMs(shownList[at] ?? said.text);
      const rest = shownList.slice(early ? at : at + 1).join(" ");
      now.current.leaving = true;
      clock.stop();
      setLeaving("back");
      window.setTimeout(() => stepBack(said.n, { rest, early }), reduced ? 0 : STEP_MS);
    });
  }, [on, said?.n]);

  const shownText = said ? (list[page] ?? text) : text;
  return createPortal(<div ref={card} className="guide-caption" popover="manual" role="group" aria-label={`${by} says`} data-n={said?.n ?? ""}
    data-ai={ai || undefined} data-asking={asking || undefined} data-settled={settled || undefined} data-leaving={leaving || undefined}
    onAnimationEnd={(event) => { if (event.target === card.current) setSettled(true); }}
    onPointerEnter={() => clock.hold(true)}
    onPointerLeave={() => clock.hold(false)}>
    <span className="guide-line" aria-hidden="true">
      <span ref={name} className="guide-by">{ai ? "✦ " : ""}{by}</span>{" "}
      <span ref={words} key={page} className="guide-text"><Markdown text={shownText} /></span>
    </span>
    {where && <span className="guide-where" aria-hidden="true">{where}</span>}
    {said?.ask && <span className="guide-asks">
      <button type="button" className="guide-btn guide-primary" onClick={() => goAhead(said.n)}>Go ahead <kbd>↵</kbd></button>
      <button type="button" className="guide-btn" onClick={() => later(said.n)}>Later <kbd>L</kbd></button>
      <button type="button" className="guide-btn" onClick={() => dropIt(said.n)}>Drop it <kbd>esc</kbd></button>
      {micOn && <span className="guide-over">or talk over me<span className="guide-over-more"> to stop</span></span>}
    </span>}
  </div>, document.body);
}

/** At most this many held cards at once; the rest are a count. */
const CARDS = 3;
/** Below this width the held stack folds to a chip (a phone): cards would cover the map you're talking about. */
const NARROW = 560;

/** The held stack: questions waiting for your pause and what you talked over, in L1's held region once the page has
 *  one (data-slot="held"), else bottom right over the map, clear of the dock and the shelf; on a phone a chip. */
function HeldStack({ held, ai }: { held: readonly Held[]; ai: (name: string) => boolean }) {
  const slot = useSlot("held");
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (slot) return;
    let frame = 0;
    const tick = () => {
      const el = box.current;
      if (el) {
        const width = document.documentElement.clientWidth, height = window.innerHeight;
        setNarrow(width < NARROW);
        // Above what sits in the bottom-right corner (the shelf; the Spine's camera corner, which today's app puts there),
        // and above the dock's column where the stack would reach it.
        const corner = ['[data-slot="bottom-right"]', '[data-slot="shelf"]', ".spine-corner-right"].map(drawnBox).filter((r): r is DOMRect => !!r);
        const column = drawnBox(".dock-inner") ?? drawnBox('[data-guide="composer"]');
        let foot = corner.length ? Math.min(...corner.map((r) => r.top)) - 8 : height - GUTTER;
        const left = width - GUTTER - el.offsetWidth;
        if (column && left < column.right + 8) foot = Math.min(foot, column.top - 8);
        const status = drawnBox('[data-slot="status"]');
        if (status && status.top > height / 2) foot = Math.min(foot, status.top - 8);
        el.style.bottom = `${Math.round(Math.max(GUTTER, height - foot))}px`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [slot]);
  const shown = held.slice(0, CARDS);
  const more = held.length - shown.length;
  const cards = <>
    {shown.map((item) => <HeldCard key={item.n} item={item} ai={ai(item.by)} />)}
    {more > 0 && <p className="guide-held-more"><b>{more}</b> more held</p>}
  </>;
  if (slot) return createPortal(<section className="guide-held" data-place="slot" aria-label="Held for your pause">{cards}</section>, slot);
  return createPortal(<section ref={box} className="guide-held" data-place="floating" data-narrow={narrow || undefined} aria-label="Held for your pause">
    {narrow ? <>
      {open && <div className="guide-held-cards">{cards}</div>}
      <button type="button" className="guide-held-chip" aria-expanded={open} onClick={() => setOpen(!open)}>Held <b>{held.length}</b></button>
    </> : cards}
  </section>, document.body);
}

function HeldCard({ item, ai }: { item: Held; ai: boolean }) {
  const question = item.kind === "question";
  const state = item.state === "waiting" ? (question ? "asks when you stop" : "says when you stop") : item.state === "later" ? "Later" : "Talked over";
  const open = question ? "Answer" : item.state === "over" ? "Continue" : "Go ahead";
  return <div className="guide-held-card" data-state={item.state} data-held={item.n} role="group" aria-label={`${item.by}, ${state}`}>
    <div className="guide-held-head">
      <span className="guide-by" data-ai={ai || undefined}>{ai ? "✦ " : ""}{item.by}</span>
      <span className="guide-held-state">{state}</span>
    </div>
    <p className="guide-held-text"><Markdown text={question ? mainWords(item.text) : item.text} /></p>
    <div className="guide-held-acts">
      <button type="button" className="guide-btn" onClick={() => askNow(item.n)}>{open}</button>
      {item.state === "waiting"
        ? <button type="button" className="guide-btn" onClick={() => laterHeld(item.n)}>Later</button>
        : <button type="button" className="guide-btn" onClick={() => dropHeld(item.n)}>Drop it</button>}
    </div>
  </div>;
}

/** The page's region named `name` (bricks/contract.ts `SlotName`) while it's there: it comes and goes with the layout. */
function useSlot(name: string): HTMLElement | null {
  const find = () => document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  const [slot, setSlot] = useState<HTMLElement | null>(find);
  useEffect(() => {
    let frame = 0;
    const look = () => { frame = 0; setSlot(find()); };
    const watcher = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(look); });
    watcher.observe(document.body, { childList: true, subtree: true });
    return () => { watcher.disconnect(); cancelAnimationFrame(frame); };
  }, [name]);
  return slot;
}
