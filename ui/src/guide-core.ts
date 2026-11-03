// The guide's rules: another participant (an AI joined with a name, e.g. the Friend over its bridge, over the core's
// `point`, `caption` and `hold` messages: core/src/guide.rs) shows you a part of the screen, says a line, or holds a
// question for your pause. What each `data-guide` name is, where a part that isn't on screen is instead, the arrow's
// place at the part (short, from the nearest side with room), how a long caption pages and how long each page stays, and
// the held questions: when one is asked and what Go ahead, Later, Drop it and talking over do. Pure, so
// scripts/guide-check.mjs runs it without a browser; Guide.tsx draws it. docs/guide.md lists the names (the check holds
// the two to each other).
import { useSyncExternalStore } from "react";
import type { BrickOn } from "./bricks/contract";
import type { Thread, Thought, World } from "./core";
import { readMs } from "./attention-core";
import { NATURAL_PAUSE_MS } from "./legible";
import { resolveMerged } from "./merges";
import { DECIDE_MS, REACH_MS, SHORTEST_MS, slowReadMs } from "./notice-rules";

export { NATURAL_PAUSE_MS };

/** The core's relay of a point, a caption or a held question (protocol.rs `ServerMsg::Guide`). */
/** `urgent`: a held question that may jump the line (the Interrupt level). */
export type GuideMsg = { type: "guide"; kind: "point" | "caption" | "hold"; target: string | null; text: string; by: string; at_ms: number; urgent?: boolean };

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

// ---- The arrow: a short one at the part, from the nearest side that is clear.

export type Box = { left: number; top: number; right: number; bottom: number };
export type Point2 = { x: number; y: number };
/** The side of the part the arrow comes in from: its tail is on that side, its tip at the part. */
export type Side = "above" | "below" | "left" | "right";
/** The arrow as a curve: from `start` (its tail) along `c1`, arriving along `c2` at `end` (its tip, clear of the part's
 *  ring on its `side`). */
export type Route = { side: Side; start: Point2; c1: Point2; c2: Point2; end: Point2 };
/** Which arrow, relative to the part (so it keeps its place as the part moves): the side, how far along that side's edge
 *  the tip is (px from the part's left or top), how long it runs, and how far its tail sways sideways. */
export type Plan = { side: Side; along: number; run: number; sway: number };

/** The gutter every popover keeps from the screen's edge (onscreen.ts). */
export const GUTTER = 16;
/** The ring's room around the part, as a focus ring's offset is. */
export const RING_PAD = 6;
/** Between the arrowhead's tip and the part: clear of its ring (`RING_PAD` out, 2 px wide). */
export const TIP_GAP = RING_PAD + 8;
/** How far the arrow runs from its tail to its tip, longest first: it is drawn as long as the room round the part
 *  allows. Never a sweep across the screen: it stays at the part, where what it crosses is known. */
export const RUNS = [72, 52, 36] as const;
/** The tail may sway sideways by this share of the run (an S, never a bow), toward the caption first. */
const SWAY = 0.3;
/** The room worth measuring round the part: as far as the arrow can reach, and a little more. */
export const AROUND = TIP_GAP + RUNS[0] + Math.ceil(SWAY * RUNS[0]) + 16;
/** A part nearer the caption than this needs no arrow: the caption is at it already, and its ring shows which. */
export const NEAR = 46;
/** Room an arrow keeps from what's drawn near it: the halo's half width and a little more. */
const CLEARANCE = 6;
/** The arrowhead's length (Guide.tsx draws 16, 13 on a phone): its footprint takes the larger. */
const HEAD = 16;
/** Where the tip may land along an edge: this far in from either end (a corner's curve isn't the part). */
const END_ROOM = 24;
/** A part this small is a control (a button, a chip): its tip may land at its middle or a fifth in from an end. */
const SMALL = { width: 200, height: 56 };
/** The arrow keeps this far from the screen's edges, and from the room's. */
const EDGE = 8;

const clamp = (n: number, low: number, high: number) => Math.min(Math.max(n, low), Math.max(low, high));
const NORMAL: Record<Side, Point2> = { above: { x: 0, y: -1 }, below: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** The order sides win a tie in: under the part first, where an arrow from the caption would come from. */
const ORDER: Side[] = ["below", "right", "left", "above"];

/** The arrow for `plan` at the part drawn at `to`: its tip `TIP_GAP` out from the facing edge, its tail `run` out and
 *  `sway` sideways, the curve leaving and arriving along the side's normal (a straight line when `sway` is 0). */
export function shape(plan: Plan, to: Box): Route {
  const across = plan.side === "above" || plan.side === "below";
  const n = NORMAL[plan.side];
  const span = across ? to.right - to.left : to.bottom - to.top;
  const along = clamp(plan.along, Math.min(END_ROOM, span / 2), span - Math.min(END_ROOM, span / 2));
  const end: Point2 = across
    ? { x: to.left + along, y: plan.side === "below" ? to.bottom + TIP_GAP : to.top - TIP_GAP }
    : { x: plan.side === "right" ? to.right + TIP_GAP : to.left - TIP_GAP, y: to.top + along };
  const start: Point2 = across ? { x: end.x + plan.sway, y: end.y + n.y * plan.run } : { x: end.x + n.x * plan.run, y: end.y + plan.sway };
  const k = plan.run * 0.45;
  return { side: plan.side, start, end, c1: { x: start.x - n.x * k, y: start.y - n.y * k }, c2: { x: end.x + n.x * k, y: end.y + n.y * k } };
}

/** Where the arrow is drawn, as points: along its curve, and the arrowhead's corners and middle behind the tip. */
function footprint(route: Route): Point2[] {
  const { start: a, c1, c2, end: d } = route;
  const out: Point2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    out.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * d.y });
  }
  // The head, behind the tip (`c2` is out from the tip on its side's normal): its base's corners and middle, and its middle.
  const away = { x: c2.x - d.x, y: c2.y - d.y }, size = Math.hypot(away.x, away.y) || 1;
  const back = { x: away.x / size, y: away.y / size }, wing = { x: -back.y, y: back.x };
  for (const [length, width] of [[HEAD, -0.6], [HEAD, 0], [HEAD, 0.6], [HEAD / 2, 0]]) {
    out.push({ x: d.x + back.x * length + wing.x * HEAD * width, y: d.y + back.y * length + wing.y * HEAD * width });
  }
  return out;
}

/** Where along `side`'s edge the tip may land, best first: a control at its middle, then a fifth in from either end
 *  (so a neighbour beside it doesn't rule the side out); a card or a line of text near its head, where its title is, or
 *  (under or over it) near its right end, where a line of text ends first. */
function alongs(to: Box, side: Side): number[] {
  const across = side === "above" || side === "below";
  const w = to.right - to.left, h = to.bottom - to.top, span = across ? w : h;
  const small = w <= SMALL.width && h <= SMALL.height;
  const list = small ? [span / 2, span / 5, (span * 4) / 5] : across ? [span - 40, span / 2, 40] : [Math.min(span / 2, 28), span / 2, span - 28];
  const room = Math.min(END_ROOM, span / 2);
  return [...new Set(list.map((n) => Math.round(clamp(n, room, span - room))))];
}

export type Screen = { width: number; height: number; top?: number; bottom?: number };

/** The arrow at the part drawn at `to`, as the caption `from` is placed: short, on the side that faces the caption
 *  where that side is clear and else the next, the longest run that's clear, the tip's place along the edge, then
 *  the tail's sway, each tried in turn. Clear means nothing in `avoid` (the controls, lines of text and cards near the
 *  part, as drawn) is within reach of its line, its head or its tail, and all of it is on screen (`screen.top` and
 *  `bottom` bound the room the page's parts are seen in). `keep`, the arrow drawn before, stays while it's still clear,
 *  so it never flips between equal ones. Null when no side has room, or the part is level with the caption or under it,
 *  within NEAR (the composer: the caption is at it already): the ring alone says which. `edge` is a part scrolled out of the
 *  room (`to` is a sliver at the edge it's past): an arrow from inside the room, pointing out toward it. */
export function pointer(to: Box, from: Box, screen: Screen, avoid: readonly Box[], opts: { keep?: Plan | null; edge?: "top" | "bottom" } = {}): Plan | null {
  const high = screen.top ?? 0, low = screen.bottom ?? screen.height;
  // Level with the caption or under it, right there (the composer): the caption is at it already.
  if (!opts.edge && to.bottom > from.top && to.right > from.left && to.left < from.right && to.top - from.bottom < NEAR) return null;
  const onScreen = (p: Point2) => p.x >= EDGE && p.x <= screen.width - EDGE && p.y >= high + EDGE && p.y <= low - EDGE;
  const clear = (p: Point2) => !avoid.some((r) => p.x > r.left - CLEARANCE && p.x < r.right + CLEARANCE && p.y > r.top - CLEARANCE && p.y < r.bottom + CLEARANCE);
  const fits = (plan: Plan) => footprint(shape(plan, to)).every((p) => onScreen(p) && clear(p));
  if (opts.keep && fits(opts.keep)) return opts.keep;
  // Toward the caption: the sides facing it first.
  const dx = (from.left + from.right) / 2 - (to.left + to.right) / 2, dy = (from.top + from.bottom) / 2 - (to.top + to.bottom) / 2;
  const reach = Math.hypot(dx, dy) || 1;
  const facing = (side: Side) => -(NORMAL[side].x * dx + NORMAL[side].y * dy) / reach;
  const sides = opts.edge ? [opts.edge === "top" ? "below" : "above"] as Side[]
    : [...ORDER].sort((p, q) => facing(p) - facing(q) || ORDER.indexOf(p) - ORDER.indexOf(q));
  for (const side of sides) {
    const across = side === "above" || side === "below";
    const toward = Math.sign(across ? dx : dy) || 1;
    for (const run of RUNS) for (const along of alongs(to, side)) for (const sway of [0, toward * SWAY * run, -toward * SWAY * run]) {
      const plan: Plan = { side, along, run, sway };
      if (fits(plan)) return plan;
    }
  }
  return null;
}

/** What the arrow aims at for a part drawn at `rect` within `band` (the room not covered by what floats over the map):
 *  the part as seen, or, when it's out of the band, a sliver at the band's edge it's past, so the arrow says where. */
export function aimAt(rect: Box, band: { top: number; bottom: number; width: number }): { box: Box; seen: boolean } {
  const left = clamp(rect.left, 0, band.width), right = clamp(rect.right, 0, band.width);
  const top = Math.max(rect.top, band.top), bottom = Math.min(rect.bottom, band.bottom);
  if (bottom - top >= 4) return { box: { left, top, right, bottom }, seen: true };
  const edge = rect.bottom <= band.top ? band.top : band.bottom;
  return { box: { left, top: edge, right, bottom: edge }, seen: false };
}

// ---- How a caption reads: in pages of two lines, each up for its reading time.

/** At least this long, however short: the time to notice something new at the foot of the screen and look at it, as
 *  with notices (notice-rules.ts `SHORTEST_MS` is 5 s for answers that may need acting on; a caption only needs reading). */
export const CAPTION_SHORTEST_MS = 4000;
/** How long a caption, or one page of it, is up: a slow reader's time for it (175 words a minute, notice-rules.ts), which
 *  also outlasts it spoken aloud (the bridge speaks at 200), so the words never go while they're still being said. */
export function captionMs(text: string): number {
  return Math.max(CAPTION_SHORTEST_MS, slowReadMs(plain(text)));
}
/** How long a question asked at your pause waits for Go ahead, Later or Drop it: a slow reader reads it with its buttons,
 *  looks at what its arrow shows (about as many words again), decides and reaches, as an Undo notice gives
 *  (notice-rules.ts `undoUpFor`). Unanswered, it goes back to wait for you. */
export function askMs(text: string): number {
  const words = plain(text);
  return Math.max(SHORTEST_MS, slowReadMs(`${words} Go ahead Later Drop it`) + slowReadMs(words) + DECIDE_MS + REACH_MS);
}
/** Talking before an average reader could have read a question is talking over it, not answering it. */
export function overMs(text: string): number {
  return readMs(plain(text));
}

/** The words as shown, without the Markdown that marks them. */
export const plain = (text: string) => text.replace(/\*\*|\*|`/g, "");

/** At most this many lines at once, as subtitles keep (ux-revamp §3: the stage's captions, ≤ 2 lines). */
export const CAPTION_LINES = 2;

/** `text` in pages of at most `lines` lines `width` wide (`measure` gives a run of words' width in the caption's font;
 *  `first` is the room the speaker's name takes on page one's first line): whole sentences where they fit, a sentence
 *  too long for a page at its words. A bold span a page break cuts is closed and opened again, so each page reads as
 *  Markdown on its own. One page when it fits. */
export function pages(text: string, width: number, measure: (words: string) => number, first = 0, lines = CAPTION_LINES): string[] {
  const space = measure(" ");
  // How many lines `words` takes, with the name occupying only the first line (even if it leaves no room for words).
  // A word too long for a full line has a line of its own.
  const linesOf = (words: string[], indent: number) => {
    let count = 1, x = indent, hasWord = false;
    for (const word of words) {
      const w = measure(plain(word));
      const gap = hasWord ? space : 0;
      if ((hasWord || x > 0) && x + gap + w > width) { count++; x = w; } else x += gap + w;
      hasWord = true;
    }
    return count;
  };
  const fits = (words: string[], indent: number) => linesOf(words, indent) <= lines;
  const all = text.split(/\s+/).filter(Boolean);
  if (fits(all, first)) return [all.join(" ")];
  const sentences = all.join(" ").split(/(?<=[.!?…])\s+/).map((s) => s.split(" "));
  const out: string[][] = [];
  let page: string[] = [];
  const indent = () => (out.length ? 0 : first);
  for (const sentence of sentences) {
    if (fits([...page, ...sentence], indent())) { page.push(...sentence); continue; }
    if (page.length) { out.push(page); page = []; }
    // A sentence longer than a page: as many words as fit, page by page.
    for (const word of sentence) {
      if (page.length && !fits([...page, word], indent())) { out.push(page); page = []; }
      page.push(word);
    }
  }
  if (page.length) out.push(page);
  // Each page whole as Markdown: a bold span left open at a page's end closes there and opens the next.
  const texts = out.map((words) => words.join(" "));
  for (let i = 0; i < texts.length - 1; i++) {
    if ((texts[i].match(/\*\*/g) ?? []).length % 2) { texts[i] += "**"; texts[i + 1] = `**${texts[i + 1]}`; }
  }
  return texts;
}

/** A sentence short enough to take in at a glance, in words. */
const GLANCE = 6;
/** The question's main words in bold, so they catch your eye in the held stack ("main words that can catch your eye"):
 *  as the sender marked them (`**…**`); else, when it's more than one sentence, its short question ("Quick thing: Maya
 *  said Lena is away Saturday. **Sunday works?**"), or a short first sentence ("**Which Saturday?** Lena leaves on the
 *  14th."); else as it is. */
export function mainWords(text: string): string {
  if (/[*`]/.test(text)) return text;
  const sentences = text.split(/(?<=[.!?…])\s+/);
  if (sentences.length < 2) return text;
  const short = (s: string) => s.split(/\s+/).length <= GLANCE;
  const main = sentences.findIndex((s) => s.endsWith("?") && short(s));
  const at = main >= 0 ? main : short(sentences[0]) ? 0 : -1;
  return at < 0 ? text : sentences.map((s, i) => (i === at ? `**${s}**` : s)).join(" ");
}

// ---- Talking over: your words while a caption is up.

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** Whether `heard` (your words as they come) is the caption's own voice through the mic, not you: most of what's heard is
 *  in what's said (the bridge reads its captions aloud, and the mic of the window it speaks beside hears them). */
export function echoOf(heard: string, said: string): boolean {
  const words = wordsOf(heard);
  if (!words.length) return false;
  const left = new Map<string, number>();
  for (const word of wordsOf(plain(said))) left.set(word, (left.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of words) {
    const n = left.get(word) ?? 0;
    if (n) { shared++; left.set(word, n - 1); }
  }
  return shared >= Math.max(1, 0.6 * words.length);
}

// ---- The window's store: the point, the caption and the held questions, fed by core.ts's socket.

/** A point: the arrow at `target`, from `by`. `of`: the caption it belongs to (a question asked with an arrow), which
 *  takes it down when it goes. */
export type Shown = { target: string; text: string; by: string; at: number; n: number; of?: number };
/** A question held for your pause, or a line of a caption (`line`): one said while you talked or typed, or what you
 *  talked over. `waiting`: it's asked (said) by itself at your next pause; `later` (you said Later, or left it
 *  unanswered) and `over` (you talked over it) wait for you. `urgent` (the Interrupt level): it jumps the line. */
export type Held = { n: number; text: string; target: string | null; by: string; kind: "question" | "line"; state: "waiting" | "later" | "over"; urgent: boolean };
/** The caption up: `ask` while it's a held question asked, with Go ahead, Later and Drop it. */
export type Said = { text: string; by: string; n: number; ask?: Held };
export type GuideState = { point: Shown | null; caption: Said | null; held: readonly Held[] };
export const NOTHING: GuideState = { point: null, caption: null, held: [] };
/** At most this many held at once: the oldest go first (a sender stuck in a loop can't bury the screen). */
export const HELD_MAX = 12;

/** The question being asked, back to the held stack, first in line, as `state` (a newer caption, or another question
 *  opened, came first: `waiting`; you said Later or left it: `later`; you talked over it: `over`), its arrow down. */
function returned(state: GuideState, as: Held["state"]): GuideState {
  const ask = state.caption?.ask;
  if (!ask) return state;
  return { point: state.point?.of === state.caption!.n ? null : state.point, caption: null, held: [{ ...ask, state: as }, ...state.held] };
}

/** The caption gone (read, stepped back or dropped), and the arrow that was its. */
function unsaid(state: GuideState): GuideState {
  if (!state.caption) return state;
  return { ...state, caption: null, point: state.point?.of === state.caption.n ? null : state.point };
}

/** The state after a message: one point at a time (a new one replaces it; only its own sender takes it down), one
 *  caption at a time, and the held questions in the order they came. `n` counts messages, so the same words again
 *  are a new caption, read again. A caption said while you're `busy` (talking or typing, until a natural pause) never
 *  talks over you: it waits in the held stack and is said at your pause. */
export function guided(state: GuideState, msg: GuideMsg, n: number, busy = false): GuideState {
  if (msg.kind === "caption") {
    if (!msg.text) return state;
    if (busy) return { ...state, held: [...state.held, { n, text: msg.text, target: null, by: msg.by, kind: "line" as const, state: "waiting" as const, urgent: false }].slice(-HELD_MAX) };
    // A newer caption replaces the one up (and its arrow); a question being asked goes back to wait for your pause.
    return { ...unsaid(returned(state, "waiting")), caption: { text: msg.text, by: msg.by, n } };
  }
  if (msg.kind === "hold") {
    // No words: the sender takes back what it still holds, the question it's asking too.
    if (!msg.text) {
      const asking = state.caption?.ask?.by === msg.by;
      return { ...(asking ? unsaid(state) : state), held: state.held.filter((h) => h.by !== msg.by) };
    }
    // The same question again is the one held, not a second (its arrow as sent last).
    if (state.caption?.ask?.by === msg.by && state.caption.ask.text === msg.text) return state;
    const held = state.held.filter((h) => !(h.by === msg.by && h.text === msg.text));
    return { ...state, held: [...held, { n, text: msg.text, target: msg.target, by: msg.by, kind: "question" as const, state: "waiting" as const, urgent: !!msg.urgent }].slice(-HELD_MAX) };
  }
  // A point with words says them now: they take the caption's place (a question being asked keeps it).
  if (msg.target) {
    const base = msg.text && !state.caption?.ask ? unsaid(state) : state;
    return { ...base, point: { target: msg.target, text: msg.text, by: msg.by, at: msg.at_ms, n } };
  }
  return state.point && state.point.by === msg.by ? { ...state, point: null } : state;
}

/** The held stack in the order it comes up, one thing at a time: what waits for your pause first, the urgent (the
 *  Interrupt level) ahead of the line, each in the order it came; then what waits for you (put off, talked over),
 *  the latest first. Nothing is dropped: the rest wait their turn. */
export function inLine(held: readonly Held[]): Held[] {
  const waiting = held.filter((h) => h.state === "waiting");
  return [...waiting.filter((h) => h.urgent), ...waiting.filter((h) => !h.urgent), ...held.filter((h) => h.state !== "waiting")];
}

/** What your pause brings up: the first in line that waits for one, unless a caption is up (the speaker is talking). */
export function nextAsk(state: GuideState): Held | null {
  return state.caption ? null : inLine(state.held).find((h) => h.state === "waiting") ?? null;
}

/** Held `heldN` asked now (your pause came, or you opened it): its caption with Go ahead, Later and Drop it, and its
 *  arrow if it points at something; a question asked before it goes back to wait for you. What you talked over of a
 *  caption is said again as a caption, nothing to answer. */
export function asked(state: GuideState, heldN: number, n: number, now: number): GuideState {
  const item = state.held.find((h) => h.n === heldN);
  if (!item) return state;
  const before = unsaid(returned(state, "later"));
  const held = before.held.filter((h) => h.n !== heldN);
  if (item.kind === "line") return { ...before, held, caption: { text: item.text, by: item.by, n } };
  const point = item.target ? { target: item.target, text: "", by: item.by, at: now, n, of: n } : before.point;
  return { point, held, caption: { text: item.text, by: item.by, n, ask: item } };
}

/** Go ahead: the question is yours to answer; it stays its reading time, its arrow with it, and leaves the stack. */
export function wentAhead(state: GuideState): GuideState {
  return state.caption?.ask ? { ...state, caption: { text: state.caption.text, by: state.caption.by, n: state.caption.n } } : state;
}

/** Later, or left unanswered: back to the stack, where it waits for you. */
export function putOff(state: GuideState): GuideState {
  return returned(state, "later");
}

/** Drop it: gone, its arrow too. */
export function dropped(state: GuideState): GuideState {
  return state.caption?.ask ? unsaid(state) : state;
}

/** Your words came while the caption was up: it steps back. A question you talked over before you could have read it
 *  (`early`) goes back to the stack, marked so; one you answered is done. What a caption hadn't shown yet (`rest`) waits
 *  in the stack, nothing asked. */
export function talkedOver(state: GuideState, { rest = "", early = false }: { rest?: string; early?: boolean } = {}): GuideState {
  const caption = state.caption;
  if (!caption) return state;
  if (caption.ask) return early ? returned(state, "over") : unsaid(state);
  const gone = unsaid(state);
  if (!rest.trim()) return gone;
  const held: Held = { n: caption.n, text: rest.trim(), target: null, by: caption.by, kind: "line", state: "over", urgent: false };
  return { ...gone, held: [held, ...gone.held].slice(0, HELD_MAX) };
}

/** A held card's Later: it waits for you, not your next pause. */
export function heldLater(state: GuideState, n: number): GuideState {
  return { ...state, held: state.held.map((h) => (h.n === n ? { ...h, state: "later" as const } : h)) };
}

/** A held card's Drop it: gone. */
export function heldDropped(state: GuideState, n: number): GuideState {
  return { ...state, held: state.held.filter((h) => h.n !== n) };
}

// ---- Your turn: whether you're talking or typing, for the pause a held question waits for.

/** Your words are being heard now (a turn under way). */
let speaking = false;
/** When you last talked, typed or came back to the page (ms since 1970); 0 before any of it. */
let lastBusy = 0;
/** When the last caption went (read, answered, dropped or stepped back): the next held line waits a beat after it. */
let lastSaid = 0;
/** Your words, as the window hears them (`on("words")`): "" once a turn ends, which starts the pause. */
export function heard(words: string, now = Date.now()) { speaking = !!words.trim(); lastBusy = now; }
/** You typed, or came back to the page: the pause starts again. */
export function busy(now = Date.now()) { lastBusy = now; }
/** Whether it's your turn: your words are being heard, or came (or keys did) within a natural pause (legible.ts
 *  NATURAL_PAUSE_MS). A caption said then waits for your pause. */
export function yourTurn(now = Date.now()): boolean {
  return speaking || now - lastBusy < NATURAL_PAUSE_MS;
}
/** How long until a held question may be asked: a natural pause of quiet since your last words or keys, and since the
 *  last caption went (a beat between two of the speaker's lines); 0 once there, Infinity while your words are heard. */
export function pauseIn(now = Date.now()): number {
  return speaking ? Infinity : Math.max(0, Math.max(lastBusy, lastSaid) + NATURAL_PAUSE_MS - now);
}

let state = NOTHING;
let count = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const set = (next: GuideState) => {
  if (next === state) return;
  if (state.caption && !next.caption) lastSaid = Date.now();
  state = next;
  notify();
};

/** The state now (for event handlers; a component uses `useGuide`). */
export const current = () => state;

/** Takes a guide message from the socket; false for any other message. */
export function receiveGuide(msg: { type: string }): boolean {
  if (msg.type !== "guide") return false;
  set(guided(state, msg as GuideMsg, ++count, yourTurn()));
  return true;
}

/** Esc or a click: the point goes. A question's arrow stays with it: its own buttons end it. */
export function dismissPoint() { if (state.point && !state.point.of) set({ ...state, point: null }); }

/** Caption `n` has been read (or the next replaced it), and its arrow with it. */
export function captionRead(n: number) { if (state.caption?.n === n) set(unsaid(state)); }

/** Your pause: the first question (or line) waiting for one is asked. False when none waits (or a caption is up). */
export function askAtPause(): boolean {
  const next = nextAsk(state);
  if (next) set(asked(state, next.n, ++count, Date.now()));
  return !!next;
}
/** A held card's Answer, Go ahead or Continue: asked (said) now. */
export function askNow(heldN: number) { set(asked(state, heldN, ++count, Date.now())); }
// What the caption's buttons and keys do, to caption `n` only (it may have been replaced while a click was under way).
const to = (n: number, change: (s: GuideState) => GuideState) => { if (state.caption?.n === n) set(change(state)); };
export function goAhead(n: number) { to(n, wentAhead); }
export function later(n: number) { to(n, putOff); }
export function dropIt(n: number) { to(n, dropped); }
export function stepBack(n: number, how: { rest?: string; early?: boolean }) { to(n, (s) => talkedOver(s, how)); }
export function laterHeld(heldN: number) { set(heldLater(state, heldN)); }
export function dropHeld(heldN: number) { set(heldDropped(state, heldN)); }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => state;
export function useGuide(): GuideState {
  return useSyncExternalStore(subscribe, read, read);
}
/** Calls `listener` each time the guide's state changes (a question held, asked or answered). Returns the way to stop. */
export function watchGuide(listener: () => void) { return subscribe(listener); }

/** The questions held for your pause and what you talked over, oldest first: for a count where the page has one (the
 *  phone's tab row), as the held stack (Guide.tsx) shows them. */
export function useHeld(): readonly Held[] {
  return useSyncExternalStore(subscribe, () => state.held, () => state.held);
}

/** Calls `listener` with the point shown each time that changes: a new one, or null once it's taken down (the bricks'
 *  `pointing`, BrickSlot.tsx). Returns the way to stop. */
export function watchPoint(listener: (point: Shown | null) => void) {
  let last = state.point;
  return subscribe(() => { if (state.point !== last) { last = state.point; listener(last); } });
}

// ---- What the guide hears: the window's events, as the bricks get them (BrickSlot.tsx hands them over).

let windowOn: BrickOn | null = null;
const onWatchers = new Set<() => void>();
/** The window's `on` (bricks/contract.ts), so the guide hears your words as bricks do: a caption steps back when you
 *  talk over it, and a held question waits for your pause. Returns the way to stop. */
export function hearFrom(on: BrickOn) {
  windowOn = on;
  onWatchers.forEach((watcher) => watcher());
  return () => {
    if (windowOn !== on) return;
    windowOn = null;
    onWatchers.forEach((watcher) => watcher());
  };
}
const watchOn = (watcher: () => void) => { onWatchers.add(watcher); return () => { onWatchers.delete(watcher); }; };
export function useWindowOn(): BrickOn | null {
  return useSyncExternalStore(watchOn, () => windowOn, () => null);
}

// ---- A brick's hint (bricks/contract.ts `hint`): shown as a point or a caption is, in this window only, never sent.

/** A hint's words at most: one line beside the arrow, as a point's caption (guide.rs `POINT_MAX`). */
export const HINT_MAX = 140;
/** A part's name, as the core takes one for a point (guide.rs `bad_name`). */
const NAME = /^[A-Za-z0-9:._-]{1,100}$/;

/** Shows `text` from `by` (a brick's name): an arrow at the part named `target` with the words in the caption it comes
 *  from, as another participant's point; without a target, as a caption. False when nothing showed: no words, more
 *  than one line or `HINT_MAX` characters, or a target that isn't a name. */
export function showHint(text: string, target: string | null, by: string): boolean {
  const line = text.trim();
  if (!line || /[\r\n]/.test(line) || [...line].length > HINT_MAX || (target !== null && !NAME.test(target))) return false;
  const words = line.split(/\s+/).join(" ");
  set(guided(state, { type: "guide", kind: target ? "point" : "caption", target, text: words, by, at_ms: Date.now() }, ++count));
  return true;
}
