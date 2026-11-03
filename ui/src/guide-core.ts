// Pointing and captions from another participant (an AI joined with a name, over the core's `point` and `caption`
// messages: core/src/guide.rs): what each `data-guide` name is, where a part that isn't on screen is instead, where the
// arrow and its caption go, and how long a caption stays. Pure, so scripts/guide-check.mjs runs it without a browser;
// Guide.tsx draws it. docs/guide.md lists the names (the check holds the two to each other).
import { useSyncExternalStore } from "react";
import type { Thread, Thought, World } from "./core";
import { resolveMerged } from "./merges";
import { slowReadMs } from "./notice-rules";

/** The core's relay of a point or a caption (protocol.rs `ServerMsg::Guide`). */
export type GuideMsg = { type: "guide"; kind: "point" | "caption"; target: string | null; text: string; by: string; at_ms: number };

/** The fixed names, in the order docs/guide.md lists them: what each is, as a sentence names it. Threads, points and a
 *  view brick's switch are named with their id: `thread:<id>`, `point:<id>`, `view:<id>`. */
export const NAMES: Record<string, string> = {
  composer: "the box where you type or talk",
  mic: "the mic",
  help: "the ? list of what you can say",
  recap: "Recap",
  import: "Import chats",
  export: "Export",
  status: "the status line",
  room: "the room menu",
  apps: "the Apps panel",
  "make-app": "the field that asks for an app",
  catalog: "the Catalog button",
  notice: "the notice under the header",
  undo: "Undo",
  views: "the view switch",
  "view:map": "the Map button",
  "view:palace": "the Palace button",
  search: "search",
  focus: "Focus",
  "back-to-active": "Back to active",
  map: "the map",
  palace: "the Palace",
  unfinished: "the unfinished card",
  away: "While you were away",
  pending: "the thoughts finding their place",
  "send-card": "the message about to send",
};
/** The names made from an id. */
export const PATTERNS = ["thread:", "point:", "view:"] as const;

type Map = Pick<World, "threads" | "thoughts" | "merged">;

/** What `name` is, as a sentence names it ("a thought in “Rent”"); for the screen reader, who can't see the arrow. */
export function label(name: string, map: Map): string {
  if (NAMES[name]) return NAMES[name];
  const id = name.slice(name.indexOf(":") + 1);
  const thread = (threadId: string | null) => (threadId ? map.threads.find((t) => t.id === resolveMerged(map, threadId)) : undefined);
  if (name.startsWith("thread:")) return thread(id) ? `“${thread(id)!.title}”` : "a thread";
  if (name.startsWith("point:")) {
    const home = thread(map.thoughts.find((t) => t.id === id)?.thread_id ?? null);
    return home ? `a thought in “${home.title}”` : "a thought";
  }
  if (name.startsWith("view:")) return `the ${id} view's button`;
  return `“${name}”`;
}

/** What the window knows when a name isn't on screen: the view, what hides cards, and which names are on screen. */
export type Where = {
  map: Map;
  /** "map", "palace" or a view brick's id. */
  view: string;
  query: string;
  focus: boolean;
  /** A part with this name is on screen now. */
  shown: (name: string) => boolean;
  /** The card of thread `id` is on screen but folded. */
  folded: (id: string) => boolean;
};

/** Where a part that isn't on screen is: `via`, the name of what reveals it (aimed at instead, when on screen), and the
 *  line that says so. Rules, never a guess: no rule, no arrow, and the line says it isn't on screen. */
export type Instead = { via: string | null; line: string };

const quoted = (thread: Thread) => `“${thread.title}”`;
const theThread = (map: Map, id: string | null | undefined) => (id ? map.threads.find((t) => t.id === resolveMerged(map, id)) : undefined);

/** Where thread `id`'s card is when it isn't on screen: what reveals it, where it is, and what to do. */
function threadIs(id: string, at: Where): { via: string | null; where: string; act: string } {
  if (at.view !== "map") return { via: "view:map", where: "on the Map", act: "switch to the Map here" };
  if (at.query.trim()) return { via: "search", where: "hidden by your search", act: "clear it to see it" };
  if (at.focus) return { via: "focus", where: "hidden by Focus", act: "turn Focus off to see it" };
  const seen = new Set<string>();
  for (let up = theThread(at.map, theThread(at.map, id)?.parent_id); up && !seen.has(up.id); up = theThread(at.map, up.parent_id)) {
    seen.add(up.id);
    if (at.shown(`thread:${up.id}`)) return { via: `thread:${up.id}`, where: `folded inside ${quoted(up)}`, act: "Show opens it" };
  }
  return { via: null, where: "not on screen", act: "" };
}

/** Lines for parts that come and go, said when one isn't up. */
const NOT_UP: Record<string, string> = {
  undo: "Undo shows on a notice you can take back, and none is up now.",
  notice: "No notice is up now.",
  unfinished: "The unfinished card isn't up now.",
  away: "“While you were away” isn't up now.",
  pending: "No thought is finding its place now.",
  "send-card": "No message is about to send.",
  export: "Export shows once the map has a thought.",
  room: "The room menu shows in a room.",
  status: "The status line isn't on screen now.",
};

/** Where `name` is when no part with that name is on screen (Guide.tsx asks only then). */
export function instead(name: string, at: Where): Instead {
  const map = at.map;
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (name.startsWith("thread:")) {
    const asked = name.slice(7);
    const thread = theThread(map, asked);
    if (!thread) return { via: null, line: "That thread isn't on this map." };
    // Merged away: its card is the one it went into.
    if (thread.id !== asked && at.shown(`thread:${thread.id}`)) return { via: `thread:${thread.id}`, line: `It's part of ${quoted(thread)} now.` };
    const is = threadIs(thread.id, at);
    return { via: is.via, line: is.act ? `${quoted(thread)} is ${is.where}: ${is.act}.` : `${quoted(thread)} isn't on screen now.` };
  }
  if (name.startsWith("point:")) {
    const thought: Thought | undefined = map.thoughts.find((t) => t.id === name.slice(6));
    if (!thought) return { via: null, line: "That thought isn't on this map." };
    if (!thought.placed) return { via: "pending", line: "It's still finding its place." };
    const thread = theThread(map, thought.thread_id);
    if (!thread) return { via: null, line: "That thought isn't on a thread." };
    if (at.shown(`thread:${thread.id}`)) {
      // Its card, folded or open, or its picture in the Palace, which opens it on the Map.
      const act = at.view === "palace" ? ": open it here" : at.folded(thread.id) ? ": Show opens it" : "";
      return { via: `thread:${thread.id}`, line: `It's in ${quoted(thread)}${act}.` };
    }
    const is = threadIs(thread.id, at);
    return { via: is.via, line: is.act ? `It's in ${quoted(thread)}, ${is.where}: ${is.act}.` : `It's in ${quoted(thread)}, not on screen now.` };
  }
  const threads = map.threads.length;
  if (name === "catalog" || name === "make-app") return { via: "apps", line: `${sentence(NAMES[name])} is in Apps: open Apps.` };
  if (name === "map") return { via: "view:map", line: "The map is a view away: switch to the Map here." };
  if (name === "palace") return { via: "view:palace", line: "The Palace is a view away: switch to it here." };
  if (name === "views" || name.startsWith("view:")) {
    if (!threads) return { via: null, line: "The views show once the map has a thread." };
    return { via: null, line: name.startsWith("view:") && !NAMES[name] ? "That view is off: switch it on in Apps › Catalog." : "The views aren't on screen now." };
  }
  if (name === "search" || name === "focus" || name === "back-to-active") {
    const what = sentence(NAMES[name]);
    if (!threads) return { via: null, line: `${what} shows once the map has a thread.` };
    if (at.view !== "map") return { via: "view:map", line: `${what} is on the Map: switch to it here.` };
    if (name !== "search" && threads < 2) return { via: null, line: `${what} shows once the map has two threads.` };
    return { via: null, line: name === "back-to-active" ? "Back to active shows while you have a thread to go back to." : `${what} isn't on screen now.` };
  }
  if (NOT_UP[name]) return { via: null, line: NOT_UP[name] };
  return { via: null, line: `Nothing called “${name}” is on this screen.` };
}

// ---- Where the arrow and its caption go.

export type Box = { left: number; top: number; right: number; bottom: number };
export type Point2 = { x: number; y: number };
export type Side = "above" | "below" | "left" | "right";
export type Placed = { side: Side; tip: Point2; tail: Point2; caption: { left: number; top: number } };

/** The gutter every popover keeps from the screen's edge (onscreen.ts). */
export const GUTTER = 16;
/** Between the arrowhead and the part: clear of the spotlight's ring (`HOLE_PAD` out, 2 px wide), so the tip
 *  touches neither the part nor the ring. */
export const TIP_GAP = 10;
/** The spotlight's room around the part, as a focus ring's offset is. */
export const HOLE_PAD = 6;
/** Between the arrow's tail and its caption. */
export const CAPTION_GAP = 4;
/** The arrow's length: long enough to read as an arrow from across a laptop screen (≈ the composer's height and a
 *  half), shorter on a phone, where the caption needs the room. */
export const arrowLength = (width: number) => (width < 560 ? 52 : 72);

const clamp = (n: number, low: number, high: number) => Math.min(Math.max(n, low), Math.max(low, high));

/** The arrow aimed at `part` (as drawn on screen), and its caption of `size` at the arrow's tail: on the side of the
 *  part with room for both, above or below first (the caption reads along a line), else left or right, else wherever
 *  there's most; the caption kept whole on screen. `screen.top` and `screen.bottom` bound them where the part is one of
 *  the page's: between the header and the dock, so neither covers the composer or the dock's cards. */
export function place(part: Box, screen: { width: number; height: number; top?: number; bottom?: number }, size: { width: number; height: number }, arrow = arrowLength(screen.width)): Placed {
  const [high, low] = [screen.top ?? 0, screen.bottom ?? screen.height];
  const room: Record<Side, number> = { above: part.top - high, below: low - part.bottom, left: part.left, right: screen.width - part.right };
  const need = (side: Side) => arrow + TIP_GAP + CAPTION_GAP + GUTTER + (side === "above" || side === "below" ? size.height : size.width);
  const fits = (side: Side) => room[side] >= need(side);
  const side: Side = fits("above") || fits("below") ? (room.above >= room.below ? "above" : "below")
    : fits("left") || fits("right") ? (room.left >= room.right ? "left" : "right")
    : (["above", "below", "left", "right"] as Side[]).reduce((best, s) => (room[s] / need(s) > room[best] / need(best) ? s : best));
  // Aimed at the middle of the part's facing edge; on a tall part (a card), at its head, where its title is.
  const x = clamp((part.left + part.right) / 2, GUTTER + 14, screen.width - GUTTER - 14);
  const y = clamp(part.top + Math.min((part.bottom - part.top) / 2, 28), high + GUTTER + 14, low - GUTTER - 14);
  const tip = side === "above" ? { x, y: part.top - TIP_GAP } : side === "below" ? { x, y: part.bottom + TIP_GAP }
    : side === "left" ? { x: part.left - TIP_GAP, y } : { x: part.right + TIP_GAP, y };
  const tail = side === "above" ? { x, y: tip.y - arrow } : side === "below" ? { x, y: tip.y + arrow }
    : side === "left" ? { x: tip.x - arrow, y } : { x: tip.x + arrow, y };
  const left = side === "left" ? tail.x - CAPTION_GAP - size.width : side === "right" ? tail.x + CAPTION_GAP : tail.x - size.width / 2;
  const top = side === "above" ? tail.y - CAPTION_GAP - size.height : side === "below" ? tail.y + CAPTION_GAP : tail.y - size.height / 2;
  return {
    side, tip, tail,
    caption: { left: clamp(left, GUTTER, screen.width - GUTTER - size.width), top: clamp(top, high + GUTTER, low - GUTTER - size.height) },
  };
}

/** What the arrow aims at for a part drawn at `rect` within `band` (the room not covered by what floats above it):
 *  the part as seen, or, when it's out of the band, a sliver at the band's edge it's past, so the arrow says where. */
export function aimAt(rect: Box, band: { top: number; bottom: number; width: number }): { box: Box; seen: boolean } {
  const left = clamp(rect.left, 0, band.width), right = clamp(rect.right, 0, band.width);
  const top = Math.max(rect.top, band.top), bottom = Math.min(rect.bottom, band.bottom);
  if (bottom - top >= 4) return { box: { left, top, right, bottom }, seen: true };
  const edge = rect.bottom <= band.top ? band.top : band.bottom;
  return { box: { left, top: edge, right, bottom: edge }, seen: false };
}

// ---- How long a caption stays.

/** At least this long, however short: the time to notice something new in a corner and look at it, as with notices
 *  (notice-rules.ts `SHORTEST_MS` is 5 s for answers that may need acting on; a caption only needs reading). */
export const CAPTION_SHORTEST_MS = 4000;
/** How long a caption is up: a slow reader's time for it (175 words a minute, notice-rules.ts), which also outlasts the
 *  caption spoken aloud (the bridge speaks at 200), so the words never go while they're still being said. */
export function captionMs(text: string): number {
  return Math.max(CAPTION_SHORTEST_MS, slowReadMs(text));
}

// ---- The window's store: the point shown, and the caption shown, fed by core.ts's socket.

export type Shown = { target: string; text: string; by: string; at: number; n: number };
export type Said = { text: string; by: string; n: number };
export type GuideState = { point: Shown | null; caption: Said | null };
export const NOTHING: GuideState = { point: null, caption: null };

/** The state after a message: one point at a time (a new one replaces it; only its own sender takes it down), one
 *  caption at a time. `n` counts messages, so the same words again are a new caption, read again. */
export function guided(state: GuideState, msg: GuideMsg, n: number): GuideState {
  if (msg.kind === "caption") return msg.text ? { ...state, caption: { text: msg.text, by: msg.by, n } } : state;
  if (msg.target) return { ...state, point: { target: msg.target, text: msg.text, by: msg.by, at: msg.at_ms, n } };
  return state.point && state.point.by === msg.by ? { ...state, point: null } : state;
}

let state = NOTHING;
let count = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const set = (next: GuideState) => { if (next !== state) { state = next; notify(); } };

/** Takes a guide message from the socket; false for any other message. */
export function receiveGuide(msg: { type: string }): boolean {
  if (msg.type !== "guide") return false;
  set(guided(state, msg as GuideMsg, ++count));
  return true;
}

/** Esc or a click: the point goes. */
export function dismissPoint() { set({ ...state, point: null }); }

/** Caption `n` has been read (or the next replaced it). */
export function captionRead(n: number) { if (state.caption?.n === n) set({ ...state, caption: null }); }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => state;
export function useGuide(): GuideState {
  return useSyncExternalStore(subscribe, read, read);
}

/** Calls `listener` with the point shown each time that changes: a new one, or null once it's taken down (the bricks'
 *  `pointing`, BrickSlot.tsx). Returns the way to stop. */
export function watchPoint(listener: (point: Shown | null) => void) {
  let last = state.point;
  return subscribe(() => { if (state.point !== last) { last = state.point; listener(last); } });
}

// ---- A brick's hint (bricks/contract.ts `hint`): shown as a point or a caption is, in this window only, never sent.

/** A hint's words at most: one line beside the arrow, as a point's caption (guide.rs `POINT_MAX`). */
export const HINT_MAX = 140;
/** A part's name, as the core takes one for a point (guide.rs `bad_name`). */
const NAME = /^[A-Za-z0-9:._-]{1,100}$/;

/** Shows `text` from `by` (a brick's name): an arrow at the part named `target` with the words beside it, as another
 *  participant's point; without a target, in the corner, as a caption. False when nothing showed: no words, more than
 *  one line or `HINT_MAX` characters, or a target that isn't a name. */
export function showHint(text: string, target: string | null, by: string): boolean {
  const line = text.trim();
  if (!line || /[\r\n]/.test(line) || [...line].length > HINT_MAX || (target !== null && !NAME.test(target))) return false;
  const words = line.split(/\s+/).join(" ");
  set(guided(state, { type: "guide", kind: target ? "point" : "caption", target, text: words, by, at_ms: Date.now() }, ++count));
  return true;
}
