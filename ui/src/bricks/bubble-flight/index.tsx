import { usePluginState } from "../contract";
// Bubble flight (docs/bricks.md, a panel): a thought of yours lifts out of the box you typed or said it in as a glass
// bubble, its words where they were; while the model places it (≈ 2.8 s, measured) it drifts toward the thread you're
// on, a dotted line ahead to the slot the view holds open there and a comet tail back to the box; once placed it flies
// to wherever it landed, in 400 ms at most (a turn mid-air if that's elsewhere), and settles its words onto the
// point's own: into the Spine's dashed slot (`data-slot="slot:<thought id>"`, the contract's name), onto the point on
// the Map. A view that holds slots rings the landing itself once the bubble is in (`data-flight` says it's still in
// the air); on the Map the brick rings it. After your first five, a bubble shows only once its thought is placed and
// slides straight there. A thought still unplaced after 5 s fades where it is (the slot or the dock's pill has it). A
// thought placed before its landing is drawn (your first on an empty map: the view that draws cards mounts with the
// map's first thread) is held where it is until the landing shows, then flies in as any other.
// With Reduce Motion there's no flight, only the landing's ring, unless you switch "Show the flight" on in its hint,
// which comes once, at a pause after your first landing. Every move here is drawn frame by frame from script, never a
// CSS animation, so the app's no-motion rule (styles.css) leaves a flight you asked for alone.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import pluginStyle0 from "./bubble-flight.css?inline";

type Flight = {
  id: string;
  text: string;
  /** Bubbles that leave in one go (a long paste sent in parts) stack, each a row above the last. */
  stack: number;
  /** Past your first five: no lift or drift, only a slide once placed. */
  short: boolean;
  threadId?: string;
};
type Point = { x: number; y: number };
/** Where the bubble's words go: their start (`x`) and middle (`y`), at `scale` (1: the bubble's own 15 px). */
type Aim = Point & { scale: number };

// How long a bubble waits for its thought to be placed before it fades where it is: past the slowest of nine in ten
// placings measured (≈ 4 s; the median ≈ 2.7 s).
const WAIT_MS = 5000;
/** How long a placed thought's bubble waits for its landing to be drawn before it fades where it is. The first thought
 *  on an empty map has none until its view mounts with the thread: the card is in the page 0.3 s after the placing
 *  (0.7 s with the processor throttled six times; first-landing-check), so 2 s leaves a slow machine room and still lets
 *  go of a bubble whose view has nothing to land on (the Palace, a map seen as pictures). */
const LAND_WAIT_MS = 2000;
const LIFT_MS = 160;
/** The drift goes at most this share of the way toward the thread you're on, getting there on this time scale: about
 *  43% by the median placing (2.8 s), so the flight that follows still has a way to go and a turn reads as one. */
const DRIFT = 0.5;
const DRIFT_TAU_MS = 1400;
/** The flight in, by distance: the app's glides are 400 ms at most. */
const FLY_MIN_MS = 240;
const FLY_MAX_MS = 400;
const SETTLE_MS = 140;
const FADE_MS = 150;
const RING_MS = 300;
/** Under Reduce Motion the ring stays still for a second, as the Spine's camera ring does. */
const STILL_RING_MS = 1000;
/** While flying, the tail is the last this-long of the way; it draws back as fast once the bubble is in. */
const TAIL_MS = 160;
/** Where the bubble's words start, from its left edge: its padding (12), the dot (6) and the gap (8), at scale 1. */
const WORDS_X = 26;
const EDGE = 8;
/** The app's natural pause (legible.ts NATURAL_PAUSE_MS): the hint waits for one, never speaking mid-sentence. */
const NATURAL_PAUSE_MS = 2500;
const FULL_FLIGHTS = 5;
const SHOW = "e2a2o.brick.bubble-flight.show";
const HINTED = "e2a2o.brick.bubble-flight.hinted";

function readSetting(key: string) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}
function saveSetting(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { /* This mount keeps it through React state. */ }
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** A cubic-bezier easing, as CSS names them. */
function easing(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const at = (t: number) => ((ax * t + bx) * t + cx) * t;
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const off = at(t) - p, d = slope(t);
      if (Math.abs(off) < 1e-4 || !d) break;
      t = clamp(t - off / d, 0, 1);
    }
    return ((ay * t + by) * t + cy) * t;
  };
}
/** Into the slot: a soft start out of the drift, a long settle at the end. */
const flyEase = easing(0.3, 0, 0.15, 1);
const liftEase = (t: number) => 1 - (1 - t) ** 3;

/** A quadratic curve from `a` to `b` through `c`'s pull. */
type Curve = { a: Point; c: Point; b: Point };
const on = ({ a, c, b }: Curve, s: number): Point => ({ x: (1 - s) ** 2 * a.x + 2 * (1 - s) * s * c.x + s * s * b.x, y: (1 - s) ** 2 * a.y + 2 * (1 - s) * s * c.y + s * s * b.y });
const heading = ({ a, c, b }: Curve, s: number): Point => {
  const x = 2 * (1 - s) * (c.x - a.x) + 2 * s * (b.x - c.x), y = 2 * (1 - s) * (c.y - a.y) + 2 * s * (b.y - c.y);
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
};
/** Rising first, as a bubble does, then bending toward where it's going. */
const rising = (a: Point, b: Point): Curve => ({ a, b, c: { x: a.x, y: mix(a.y, b.y, 0.5) } });
/** From where it is now, keeping its heading, so a new aim turns it mid-air instead of jumping. */
const turning = (a: Point, way: Point, b: Point): Curve => {
  const reach = Math.hypot(b.x - a.x, b.y - a.y) * 0.4;
  return { a, b, c: { x: a.x + way.x * reach, y: a.y + way.y * reach } };
};

/** The largest part of `el` on screen: a slot's dashed box, where the words will be. */
function biggest(el: Element) {
  let best: DOMRect | null = null;
  for (const part of el.children) {
    const r = part.getBoundingClientRect();
    if (r.width * r.height > (best ? best.width * best.height : 0)) best = r;
  }
  return best;
}
/** The element in `el` that holds `words` (a point's own words), deepest last. */
function wordsIn(el: Element, words: string) {
  const start = words.trim().slice(0, 16);
  if (!start) return null;
  let found: Element | null = null;
  for (const node of el.querySelectorAll("*")) {
    if ((node.textContent ?? "").trim().startsWith(start) && node.getBoundingClientRect().width) found = node;
  }
  return found;
}
/** Where the bubble's words land on `el`: on its words when it has them, else in its biggest part (a slot's box). */
function aimAt(el: Element, words: string | null): Aim {
  const rect = el.getBoundingClientRect();
  const zoom = el instanceof HTMLElement && el.offsetHeight ? rect.height / el.offsetHeight : 1;
  const text = words ? wordsIn(el, words) : null;
  if (text) {
    const r = text.getBoundingClientRect(), style = getComputedStyle(text);
    const size = parseFloat(style.fontSize) || 15;
    const line = (parseFloat(style.lineHeight) || size * 1.4) * zoom;
    return { x: r.left, y: r.top + Math.min(line, r.height) / 2, scale: clamp((size * zoom) / 15, 0.35, 1.25) };
  }
  const part = biggest(el) ?? rect;
  return { x: part.left + 9 * zoom, y: part.top + part.height / 2, scale: clamp(zoom, 0.35, 1.25) };
}
const slotOf = (id: string) => document.querySelector(`[data-slot="slot:${CSS.escape(id)}"]`);
const shown = (el: Element | null | undefined) => {
  const r = el?.getBoundingClientRect();
  return !!r && r.width > 0 && r.height > 0;
};
/** Toward the thread you're on: the slot the view holds open for this thought; the Map's card, at the line under its
 *  last point; another view's mark for it (`data-thread`, contract.ts). */
function driftAim(id: string, active: string | null): Aim | null {
  const slot = slotOf(id);
  if (shown(slot)) return aimAt(slot!, null);
  if (!active) return null;
  const card = document.getElementById(`thread-${active}`);
  if (shown(card)) {
    const points = card!.querySelectorAll('[id^="point-"]');
    const last = points[points.length - 1];
    if (shown(last)) {
      const r = last.getBoundingClientRect(), line = aimAt(last, (last.textContent ?? "").trim());
      return { ...line, y: r.bottom + r.height / 2 };
    }
    const r = card!.getBoundingClientRect();
    return { x: r.left + 24, y: r.top + 28, scale: 1 };
  }
  const mark = [...document.querySelectorAll(`[data-thread="${CSS.escape(active)}"]`)].find(shown);
  if (!mark) return null;
  const r = mark.getBoundingClientRect();
  return { x: r.left + r.width / 2 - 40, y: r.top + r.height / 2, scale: 0.8 };
}
/** Where it landed: its slot (the view then rings it), its point on the Map (the brick rings it), its point in a view
 *  that's showing it, or its thread's mark. */
function visibleTarget(el: Element | null): boolean {
  if (!shown(el)) return false;
  const r = el!.getBoundingClientRect();
  const bottom = document.querySelector(".dock")?.getBoundingClientRect().top ?? innerHeight;
  if (!(r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 48 && r.bottom <= bottom - 8)) return false;
  return ![...document.querySelectorAll('.shell-corner button, .spine-corner button')].some(control => {
    const c = control.getBoundingClientRect();
    return c.width > 0 && c.height > 0 && c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top;
  });
}
function landingAim(id: string, _threadId: string, words: string): { aim: Aim; ring: Element | null; into: boolean } | null {
  const slot = slotOf(id);
  if (visibleTarget(slot)) return { aim: aimAt(slot!, words), ring: null, into: false };
  const point = document.getElementById(`point-${id}`);
  if (visibleTarget(point)) return { aim: aimAt(point!, words), ring: point, into: false };
  const marked = document.querySelector(`[data-thought="${CSS.escape(id)}"]`);
  if (visibleTarget(marked)) return { aim: aimAt(marked!, words), ring: null, into: false };
  return null;
}
/** Where your words were: the named input, wherever the shell places it. None, no flight: never a made-up
 *  origin (the playground has no composer). */
function originOf(): { words: Point; top: number } | null {
  const composer = document.querySelector('[data-guide="composer"]') ?? document.querySelector(".composer") ?? document.querySelector('[data-slot="stage"]');
  const box = composer?.getBoundingClientRect();
  if (!composer || !box || !box.height) return null;
  const field = composer.querySelector("textarea, input:not([type=hidden])")?.getBoundingClientRect();
  // It rises clear of the dock's "Waiting" pills on today's layout, which show the same words.
  const pills = document.querySelector(".dock .pending, .dock .capture-pending")?.getBoundingClientRect();
  const top = pills && pills.height ? Math.min(box.top, pills.top) : box.top;
  return field && field.width ? { words: { x: field.left, y: field.top + field.height / 2 }, top }
    : { words: { x: box.left + 16, y: box.top + box.height / 2 }, top };
}

/** A ring where a thought landed, on the Map (a view with slots rings its own): 300 ms out and gone, or still for a
 *  second under Reduce Motion. */
function ringAt(layer: HTMLElement | null, target: Element, still: boolean) {
  if (!layer || !target.isConnected) return;
  const r = target.getBoundingClientRect();
  const ring = document.createElement("div");
  ring.className = "bubble-flight-ring";
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 3}px`, width: `${r.width + 8}px`, height: `${r.height + 6}px` });
  layer.append(ring);
  if (still || typeof ring.animate !== "function") { window.setTimeout(() => ring.remove(), STILL_RING_MS); return; }
  const ride = ring.animate([{ opacity: 0.9, transform: "scale(0.98)" }, { opacity: 0, transform: "scale(1.04)" }], { duration: RING_MS, easing: "ease-out" });
  ride.onfinish = () => ring.remove();
  window.setTimeout(() => ring.remove(), RING_MS + 200);
}

function Bubble({ flight, active, layer, remove }: { flight: Flight; active: string | null; layer: HTMLElement | null; remove: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLSpanElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const tail = useRef<SVGPathElement>(null);
  const tailTip = useRef<SVGPathElement>(null);
  const shade = useRef<SVGLinearGradientElement>(null);
  const ahead = useRef<SVGPathElement>(null);
  const [inAir, setInAir] = useState(true);
  const latest = useRef({ flight, active, layer });
  latest.current = { flight, active, layer };
  // Its tail's shade, by an id of its own: the thought's id, letters, digits and dashes only.
  const gradient = "bubble-flight-shade-" + flight.id.replace(/[^a-zA-Z0-9_-]/g, "");

  useLayoutEffect(() => {
    const bubble = element.current!;
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    const from = originOf();
    if (!from) { remove(flight.id); return; }
    const born = performance.now();
    // Keep the whole bubble in the window at any scale; `x`, `y`: where its words start, and their middle.
    const inside = (p: Point, scale: number): Point => ({
      x: clamp(p.x, EDGE + WORDS_X * scale, innerWidth - EDGE - (w - WORDS_X) * scale),
      y: clamp(p.y, EDGE + (h * scale) / 2, innerHeight - EDGE - (h * scale) / 2),
    });
    const lift = { x: from.words.x, y: from.top - 10 - h / 2 - flight.stack * (h + 6) };
    let phase: "wait" | "lift" | "drift" | "fly" | "settle" | "fade" | "gone" = flight.short ? "wait" : "lift";
    let since = born;
    let at: Point = from.words, scale = 0.96, opacity = 0;
    let curve: Curve | null = null;
    let fly = { ms: FLY_MAX_MS, from: 1, to: 1, ring: null as Element | null, into: false };
    let driftS = 0;
    /** The frame its thought was first seen placed, from which its landing has LAND_WAIT_MS to be drawn. */
    let placedAt: number | null = null;
    const trail: { x: number; y: number; t: number }[] = [];
    let frame = 0;

    const draw = (now: number) => {
      const p = phase === "fly" || phase === "settle" ? at : inside(at, scale);
      bubble.style.transform = `translate(${p.x - WORDS_X * scale}px, ${p.y - (h * scale) / 2}px) scale(${scale})`;
      bubble.style.opacity = String(opacity);
      if (glass.current) glass.current.style.opacity = phase === "settle" ? String(clamp(1 - (now - since) / (SETTLE_MS * 0.7), 0, 1)) : "1";
      // The tail: the way it came, from the box while it rises and drifts, the last TAIL_MS while it flies, drawing in after.
      if (phase !== "gone" && phase !== "wait") trail.push({ x: p.x + (w / 2 - WORDS_X) * scale, y: p.y, t: now });
      const keep = phase === "lift" || phase === "drift" ? Infinity : TAIL_MS;
      while (trail.length > 2 && now - trail[0].t > keep) trail.shift();
      if (phase === "gone" && trail.length && now - trail[trail.length - 1].t > TAIL_MS) trail.length = 0;
      const line = trail.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join("");
      tail.current?.setAttribute("d", trail.length > 1 ? line : "");
      const nearHead = trail.slice(Math.floor(trail.length * 0.55));
      tailTip.current?.setAttribute("d", nearHead.length > 1 ? nearHead.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join("") : "");
      if (shade.current && trail.length > 1) {
        const first = trail[0], last = trail[trail.length - 1];
        shade.current.setAttribute("x1", first.x.toFixed(1)); shade.current.setAttribute("y1", first.y.toFixed(1));
        shade.current.setAttribute("x2", last.x.toFixed(1)); shade.current.setAttribute("y2", last.y.toFixed(1));
      }
      // The way ahead while drifting: a dotted line to the slot.
      if (ahead.current) {
        if (phase === "drift" && curve && driftS < 0.98) {
          const steps = 14, dots: string[] = [];
          for (let i = 0; i <= steps; i++) {
            const q = on(curve, mix(driftS, 1, i / steps));
            dots.push(`${i ? "L" : "M"}${(q.x + (w / 2 - WORDS_X) * scale).toFixed(1)} ${q.y.toFixed(1)}`);
          }
          ahead.current.setAttribute("d", dots.join(""));
        } else ahead.current.setAttribute("d", "");
      }
    };

    // Out of the air (`data-flight` gone): the view's slot fills and rings.
    const land = () => { if (bubble.hasAttribute("data-flight")) { bubble.removeAttribute("data-flight"); setInAir(false); } };
    // Flies to where the thought landed, if the view has drawn it yet; else it stays as it is and tries again next frame.
    const startFly = (now: number) => {
      const f = latest.current.flight;
      const landing = landingAim(f.id, f.threadId!, f.text);
      if (!landing) return false;
      const goal = landing.aim;
      const way = curve && phase === "drift" ? heading(curve, Math.max(driftS, 0.02)) : { x: 0, y: -1 };
      curve = phase === "wait" ? rising(at, goal) : turning(at, way, goal);
      const distance = Math.hypot(goal.x - at.x, goal.y - at.y);
      fly = { ms: clamp(180 + distance * 0.3, FLY_MIN_MS, FLY_MAX_MS), from: scale, to: landing.aim.scale, ring: landing.ring, into: landing.into };
      phase = "fly";
      since = now;
      return true;
    };

    const step = (now: number) => {
      const { flight: f, active: a } = latest.current;
      // Time in the phase it's in: a phase that ends starts the next at once, in the same frame.
      const t = () => now - since;
      if (f.threadId && placedAt === null) placedAt = now;
      // Placed, but its landing isn't drawn (yet): it holds where it is, never longer than LAND_WAIT_MS.
      const landless = placedAt !== null && now - placedAt > LAND_WAIT_MS;
      if (phase === "wait") {
        if (f.threadId) { at = from.words; scale = 1; if (!startFly(now) && landless) phase = "gone"; }
        else if (now - born > WAIT_MS) { phase = "gone"; }
      }
      if (phase === "lift") {
        const k = liftEase(clamp(t() / LIFT_MS, 0, 1));
        at = { x: mix(from.words.x, lift.x, k), y: mix(from.words.y, lift.y, k) };
        scale = mix(0.96, 1, k);
        opacity = k;
        if (t() >= LIFT_MS) { phase = "drift"; since = now; at = lift; }
      }
      if (phase === "drift") {
        if (f.threadId) {
          if (!startFly(now) && landless) { phase = "fade"; since = now; }
        } else if (now - born > WAIT_MS) { phase = "fade"; since = now; }
        else {
          const toward = driftAim(f.id, a);
          if (toward) {
            const goal = inside(toward, toward.scale);
            curve = rising(lift, goal);
            driftS = DRIFT * (1 - Math.exp(-(now - since) / DRIFT_TAU_MS));
            at = on(curve, driftS);
          } else {
            // Nowhere to head yet: it hovers just above the box.
            curve = null;
            at = { x: lift.x, y: lift.y - 6 * (1 - Math.exp(-(now - since) / DRIFT_TAU_MS)) };
          }
          scale = 1;
          opacity = 1;
        }
      }
      if (phase === "fly") {
        const k = clamp(t() / fly.ms, 0, 1);
        // The aim moves with the view (the Spine's camera following the landing): the curve's end follows it.
        const landing = landingAim(f.id, f.threadId!, f.text);
        if (!landing) { land(); phase = "fade"; since = now; }
        if (landing && curve) {
          curve = { ...curve, b: inside(landing.aim, landing.aim.scale) };
          fly.to = landing.aim.scale;
          fly.ring = landing.ring;
        }
        at = curve ? on(curve, flyEase(k)) : at;
        // Its dot gives way to the point's own as it comes in: one dot, never two side by side.
        if (dot.current) dot.current.style.opacity = String(1 - clamp((k - 0.55) / 0.35, 0, 1));
        scale = mix(fly.from, fly.into ? fly.to * 0.7 : fly.to, flyEase(k));
        opacity = f.short ? Math.min(1, t() / 80) : 1;
        if (k >= 1) {
          // In: the view shows the point's own words under it now (the Spine's slot holds them back while a flight is in
          // the air), and rings the landing, so the bubble's words fade into the point's, not into an empty slot.
          phase = "settle";
          since = now;
          land();
          if (fly.ring) ringAt(latest.current.layer, fly.ring, false);
        }
      }
      if (phase === "settle") {
        const k = clamp(t() / SETTLE_MS, 0, 1);
        opacity = fly.into ? 1 - k : k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
        if (k >= 1) { phase = "gone"; since = now; }
      }
      if (phase === "fade") {
        const k = clamp(t() / FADE_MS, 0, 1);
        opacity = Math.min(opacity, 1 - k);
        if (k >= 1) { phase = "gone"; since = now; }
      }
      if (phase === "gone") {
        opacity = 0;
        land();
        if (!trail.length) { remove(f.id); return; }
      }
      draw(now);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // A hidden tab runs no frames: the bubble goes all the same, past its longest life.
    const timer = window.setTimeout(() => remove(flight.id), WAIT_MS + LAND_WAIT_MS + FLY_MAX_MS + SETTLE_MS + 1500);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, []);

  // `data-flight`: the name a view looks for to know a thought is still in the air (the Spine's slot waits for it).
  return <>
    <svg className="bubble-flight-sky" aria-hidden="true">
      <defs>
        <linearGradient ref={shade} id={gradient} gradientUnits="userSpaceOnUse">
          <stop offset="0" className="bubble-flight-shade-tail" />
          <stop offset="1" className="bubble-flight-shade-head" />
        </linearGradient>
      </defs>
      <path ref={ahead} className="bubble-flight-ahead" />
      <path ref={tail} className="bubble-flight-tail" stroke={`url(#${gradient})`} />
      <path ref={tailTip} className="bubble-flight-tail bubble-flight-tail-head" stroke={`url(#${gradient})`} />
    </svg>
    <div ref={element} className={flight.short ? "bubble-flight-bubble bubble-flight-short" : "bubble-flight-bubble"} data-flight={inAir ? flight.id : undefined} aria-hidden="true">
      <span ref={glass} className="bubble-flight-glass" />
      <span ref={dot} className="bubble-flight-dot" />
      <span className="bubble-flight-words">{flight.text}</span>
    </div>
  </>;
}

/** The hint that comes once under Reduce Motion: the landing is a ring, and the flight is a switch away. */
function ShowTheFlight({ show, setShow, close }: { show: boolean; setShow: (on: boolean) => void; close: () => void }) {
  const hint = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const box = document.querySelector(".composer")?.getBoundingClientRect();
      const field = document.querySelector(".composer textarea, .composer input")?.getBoundingClientRect();
      setAt(box && box.height ? { left: Math.max(EDGE, (field?.left ?? box.left + 16) - 14), bottom: innerHeight - box.top + 10 } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (event.target instanceof Node && !hint.current?.contains(event.target)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("click", outside, true); document.removeEventListener("keydown", key, true); };
  }, [close]);
  return <div ref={hint} className={at ? "bubble-flight-hint" : "bubble-flight-hint bubble-flight-hint-center"} data-hint="bubble-flight"
    style={at ? { left: at.left, bottom: at.bottom } : undefined} role="dialog" aria-label="Fly-in">
    <p className="bubble-flight-help">Reduce motion is on, so your thoughts land with a ring instead of flying there.</p>
    <button type="button" className="bubble-flight-switch" role="switch" aria-checked={show} data-guide="bubble-flight:show" onClick={() => setShow(!show)}>
      <span className="bubble-flight-track" aria-hidden="true"><span className="bubble-flight-knob" /></span>
      Show the flight
    </button>
  </div>;
}

export default function BubbleFlight({ map, on }: BrickProps) {
  // Seed placed history, including a full map, so enabling the brick never replays old thoughts.
  const seen = useRef(new Set(map.thoughts.filter((thought) => thought.placed).map((thought) => thought.id)));
  const count = useRef(0);
  const layer = useRef<HTMLDivElement>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [show, setShowState] = usePluginState("show-flight", () => readSetting(SHOW) === "true");
  const [hinted, setHinted] = usePluginState("flight-hinted", () => readSetting(HINTED) !== null);
  const [hinting, setHinting] = useState(false);
  const [landedOnce, setLandedOnce] = useState(0);
  const flies = (!reduced || show) && !map.placingUnavailable;
  const remove = (id: string) => setFlights((was) => was.filter((flight) => flight.id !== id));
  const setShow = (next: boolean) => { setShowState(next); saveSetting(SHOW, String(next)); };

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(preference.matches);
    changed();
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const cancel = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-guide="composer"], input, textarea')) return;
      if (event.type === "keydown" && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"].includes((event as KeyboardEvent).key)) return;
      setFlights([]);
    };
    document.addEventListener("pointerdown", cancel);
    document.addEventListener("wheel", cancel, { passive: true });
    document.addEventListener("keydown", cancel);
    return () => { document.removeEventListener("pointerdown", cancel); document.removeEventListener("wheel", cancel); document.removeEventListener("keydown", cancel); };
  }, []);
  // Switched to no flight: the bubbles in the air go at once.
  useEffect(() => { if (!flies) setFlights([]); }, [flies]);

  useBrickEvent(on, "landed", ({ thoughtId, threadId, mine }) => {
    if (!mine) return;
    setFlights((was) => was.map((flight) => flight.id === thoughtId && !flight.threadId ? { ...flight, threadId } : flight));
    if (flies) return;
    // No flight: the landing's ring alone, at its point on the Map (a view with slots rings its own).
    const point = document.getElementById(`point-${thoughtId}`);
    if (point) ringAt(layer.current, point, true);
    setLandedOnce((n) => n + 1);
  });

  useEffect(() => {
    const added: Flight[] = [];
    let stacked = 0;
    for (const thought of map.thoughts) {
      if (seen.current.has(thought.id)) continue;
      seen.current.add(thought.id);
      if (thought.placed || thought.speaker !== map.me || !flies || document.querySelector('.spine-follow')?.getAttribute('aria-pressed') === 'false') continue;
      const short = count.current++ >= FULL_FLIGHTS;
      added.push({ id: thought.id, text: thought.text, short, stack: short ? 0 : stacked++ });
    }
    const thoughts = new Map(map.thoughts.map((thought) => [thought.id, thought]));
    setFlights((was) => [...was, ...added].filter((flight) => thoughts.get(flight.id)?.speaker === map.me).map((flight) => {
      const thought = thoughts.get(flight.id)!;
      return thought.placed && thought.thread_id && flight.threadId !== thought.thread_id ? { ...flight, threadId: thought.thread_id } : flight;
    }));
  }, [map.thoughts, map.me, flies]);

  // The hint, once, under Reduce Motion: after your first landing, at a pause (nothing said or on its way for the
  // app's natural pause), and only when no other hint is up, so hints never stack.
  const quiet = !map.partial && !map.thoughts.some((thought) => thought.speaker === map.me && !thought.placed);
  useEffect(() => {
    if (!reduced || show || hinted || hinting || !landedOnce || !quiet) return;
    const timer = window.setTimeout(() => { if (!document.querySelector("[data-hint]")) setHinting(true); }, NATURAL_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [reduced, show, hinted, hinting, landedOnce, quiet]);
  const closeHint = () => { setHinting(false); setHinted(true); saveSetting(HINTED, "true"); };

  return <div ref={layer} className="bubble-flight">
    {flies && flights.map((flight) => <Bubble key={flight.id} flight={flight} active={map.active} layer={layer.current} remove={remove} />)}
    {hinting && <ShowTheFlight show={show} setShow={setShow} close={closeHint} />}
  </div>;
}

/** Host attaches these styles only for this mount. */
export const styles = pluginStyle0;
