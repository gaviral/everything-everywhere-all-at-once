// Where everything goes on the Spine (index.tsx draws it), from the map alone. Pure: the same map, placements and
// choices give the same places, and what a new thought adds goes below or beside what's there.
//  - A topic (a thread with no parent) is a spine: its head (picture, title, a line of who and when), then its points
//    down a line, oldest first. Topics stand in columns in the order they started, apart: unrelated until someone
//    connects them.
//  - A lone aside (a topic of one point and nothing off it, not the one you're on) floats as a bubble of its words.
//  - A tangent (a branch) hangs beside the point it came from, the parent's latest point when it started; tangents
//    alternate right and left, and a tangent's own go further out on its side. Each is a card: title, latest point
//    and a recap line (a short one, two points or fewer, sits unframed, as a note); open, its points as a small spine.
//  - A margin note (words picked in a point and answered) sits beside those words in the right-hand column, tied to
//    them by a string; a question folds to "…?" after its words until opened. On a narrow screen it tucks under them.
//  - A slot (dashed) is where your thought on its way is expected: under the tip of the thread you're on.
//  - Whatever someone placed by hand stays exactly there; the rest flows around it, never under it. What's on the
//    shelf is off the canvas; where a point was, its line keeps a small mark.
//  - Once the AI has sorted the topics under two or more named topics (`thread.topic`, the map's `topics`), each named
//    topic is a group of columns under a header with its name, in the map's order, those not sorted yet last; a group
//    grows a column every `perColumn` topics. Within a group, topics stand as the columns always did.
import type { Note, Position, Speaker, Thought, Thread } from "../contract";
import { wrap, wrapEnd, type FontKey } from "./measure";
import { trimFillers } from "../live-outline/outline";

export type Box = { x: number; y: number; w: number; h: number };
export type Side = 1 | -1;

/** Sizes in the canvas's own units (px at zoom 1). */
export const G = {
  // A topic's column: the line at 20 (the middle of its 40 px picture), words from 44. The measure, 256, holds 98% of
  // points in two lines at 15 px (median 44 characters, p98 61, max 70; five sample maps and a live one, n = 234).
  lineX: 20, tile: 40, textX: 44, textW: 256, colW: 300,
  // The head's title, 18/22 beside the picture, up to three lines (titles: median 22 characters, max 42), and under it
  // one 11/16 line of how many points and when (or who, in a call).
  titleX: 52, titleW: 248, titleLine: 22, titleMax: 3, headMeta: 16,
  // Points at 15/22, up to three lines, 12 apart, the first 16 under the head; a point's dot sits on its first line.
  pointLine: 22, pointMax: 3, pointGap: 12, headGap: 16, dotY: 11,
  // Under a point's words: a row of marks (✓ Decided, Left off: 20 px chips, 5 above), then the landing note (11/16).
  chips: 25, landLine: 18,
  // Where your thought on its way is expected: a dashed box as tall as a line with room around it.
  slotH: 28,
  // Where a point now placed elsewhere, or shelved, was: a small hollow mark that keeps the line's order.
  notch: 14,
  // A tangent's card: 232 wide, 12 inside; its title at 13/18 (two lines), its latest point at 13/18 (two lines), a
  // recap line at 11/16. Two points or fewer: unframed, as a margin note.
  cardW: 232, pad: 12, cardTitleLine: 18, cardTitleMax: 2, smallLine: 18, cardPointMax: 2, recapLine: 16, noteMax: 2,
  // A margin note: 220 wide; each entry an initial (20) and 13/18 words, three lines at most; two entries shown (the
  // note and its latest reply), the rest counted on an 11/16 line.
  marginW: 220, marginText: 194, marginLine: 18, marginMax: 3, marginGap: 6, marginShown: 2, marginMore: 16,
  // Tucked under its words on a narrow screen: 6 above, a 12 px rule.
  tuckTop: 6, tuckIn: 12,
  // A lone aside: one or two lines of 13/18 in a pill, 14 in from its ends.
  asideLine: 18, asidePad: 9, asideIn: 14, asideMax: 300,
  // The gutter between a column and its cards holds the curve from a point to its card; topics stand twice that
  // apart, so a topic's own cards read as its own (closer = belongs together).
  gutter: 48, laneGap: 96, stack: 12,
  // Topics stand in six columns, each new one under the column that was shortest when it started (a masonry): a live
  // map of 37 threads (Nov 2) then fits a 1440 × 900 window at zoom ≈ 0.4, where titles still read, instead of one
  // strip 12,800 units long (rows of four made it 6,200 tall: zoom 0.1). Under each other, topics keep the same gap
  // as side by side.
  columns: 6, rowGap: 96,
  // A named topic's group: its header (its name at 24/30 over a hairline, 44 tall), 40 above its first spine; a group
  // grows a column every 8 spines, so a live map of 37 in 6 topics takes about 7 columns, its tallest 8 spines (the
  // masonry's was 6 columns of 6 or 7); groups stand twice a column's gap apart, so a group's own columns read as its own.
  groupHead: 44, groupGap: 40, perColumn: 8, groupSpace: 96,
} as const;

/** How a point is set: on a topic's line, or inside an open card. Offsets are from the point's own box. */
export interface Look {
  variant: "spine" | "mini";
  w: number;
  lineX: number;
  textX: number;
  textW: number;
  line: number;
  font: FontKey;
  max: number;
}
export const SPINE_LOOK: Look = { variant: "spine", w: G.colW, lineX: G.lineX, textX: G.textX, textW: G.textW, line: G.pointLine, font: "point", max: G.pointMax };
/** Inside a card: 10 in from its edges, the small line at 18 from the card's edge. */
export const MINI_LOOK: Look = { variant: "mini", w: G.cardW - 20, lineX: 8, textX: 22, textW: G.cardW - 20 - 22, line: G.smallLine, font: "small", max: 3 };
const MINI_LEFT = 10;
/** Where a card's title row sits: what a curve from its point reaches. */
const CARD_ROW = G.pad + G.cardTitleLine / 2;
/** The least room left around anything placed by hand, so what flows past never touches it. */
const CLEAR = 12;

/** Someone on the map, as a point or a note shows them: yours plain, another's by an initial, the Friend's by ✦. */
export interface Who {
  name: string;
  initial: string;
  ai: boolean;
  me: boolean;
}
// An AI participant: the map's `speakers` says so (it joined with `?ai`, as the Friend's bridge does); a speaker named
// Friend is one too, for a bridge that joins without it.
const AI_NAME = /^(✦\s*)?(the\s+)?friend$/i;
export function whoIs(name: string, me: string, speakers?: ReadonlyMap<string, Speaker>): Who {
  const mine = name === me || name === "you";
  const friend = !mine && AI_NAME.test(name.trim());
  const ai = !mine && (friend || !!speakers?.get(name)?.ai);
  return { name: mine ? "you" : friend ? "AI helper" : name, initial: ai ? "✦" : (Array.from(name.trim())[0] ?? "?").toLocaleUpperCase(), ai, me: mine };
}

export type Kind = "head" | "point" | "card" | "notch" | "slot" | "aside" | "margin" | "group";

/** Words picked in a point, answered in a margin note: where they are in its words, and whether the note is folded. */
export interface Quote {
  start: number;
  end: number;
  margin: string;
  folded: boolean;
  /** Where a folded question's "…?" goes: after the words and the stop that ends them. */
  fold: number;
}

/** What's tucked under a point's words on a narrow screen: a margin note's entries, or a short tangent (its title and
 *  latest point), so a phone needn't pan sideways for either. */
export interface Tuck {
  margin: string;
  entries: Entry[];
  /** A tangent's: its thread and title. */
  thread?: string;
  title?: string;
}

/** One entry of a margin note: who, and their words as they wrap. */
export interface Entry {
  who: Who;
  text: string;
  lines: number[];
}

/** A thing on the canvas. */
export interface Item {
  /** The canvas's id for it: "t:" a thread (head, card or aside), "p:" a point, "n:" where a point was, "s:" a slot,
   *  "m:" a margin note. */
  key: string;
  /** What `positions` knows it by: a thread's id, or a point's first thought's (a slot: its thought's). */
  id: string;
  kind: Kind;
  thread: string;
  box: Box;
  /** Placed by hand: it stays exactly there. */
  pinned: boolean;
  by?: string;
  /** The item it moves with while not placed by hand (its thread's head or card). */
  up?: string;
  room?: string;
  /** 0 for a topic's own things; 1 for a tangent's, 2 for a tangent's tangent… */
  depth: number;
  /** The topic it belongs to: what the focus keeps bright. */
  topic: string;
  /** A topic's head: how far down the canvas is its own before the next topic under it starts (its title, far out,
   *  takes no more lines than fit there). */
  reach?: number;
  side?: Side;
  // A head, a card or an aside.
  title?: string;
  titleLines?: number[];
  picture?: string | null;
  dropped?: boolean;
  open?: boolean;
  count?: number;
  latest?: string;
  latestLines?: number[];
  since?: number;
  /** A head: everyone with a point on it, you first (in a call its meta line names them). */
  speakers?: Who[];
  /** A card of two points or fewer, closed: drawn unframed, as a note. */
  slim?: boolean;
  /** A card: how many tangents hang off it (their cards stand just beyond its own). */
  tangents?: number;
  /** An open card's own small line, from under its title to its last point's dot, in its own coordinates (drawn by the
   *  card: the canvas's lines go under cards). */
  line?: { x: number; y1: number; y2: number };
  // A point (an aside carries its one point's words and thoughts too).
  text?: string;
  /** Pending speech checks, each keeping its own correction controls. */
  fixes?: { thought: Thought; start: number }[];
  /** Its words as shown: a point left off is quoted, unfinished. */
  shown?: string;
  wordsOpen?: boolean;
  lines?: number[];
  look?: Look;
  decided?: boolean;
  /** Every thought it holds: a landing on any of them is a landing on it. */
  thoughts?: string[];
  at?: number;
  /** What the AI did here (corrected the words, saw a decision): the hook for notices on the line (later). */
  marks?: Mark[];
  /** Said by someone else: their initial on the line instead of a dot (✦ for the Friend). */
  who?: Who;
  /** ✓ Agreed, and by whom (a thought's `agreed_by`); without it a decision reads "✓ Decided". */
  agreed?: Who[];
  /** Said and not finished: amber, quoted, "Left off". */
  left?: boolean;
  /** A row of marks under its words. */
  chips?: boolean;
  /** The landing note under the newest landing, until the next. */
  landing?: string;
  /** Words with a margin note. */
  quotes?: Quote[];
  /** A narrow screen's margin notes, under its words: each note's entries. */
  tucks?: Tuck[];
  // A margin note.
  margin?: string;
  entries?: Entry[];
  more?: number;
  /** A named topic's header: the topic ("" for the ones not sorted yet), with `count` its spines and `title` its name. */
  group?: string;
}

export interface Mark {
  kind: "fixed" | "decided";
  text: string;
}

/** A spot on an item: its top-left plus (dx, dy). */
export interface End {
  key: string;
  dx: number;
  dy: number;
}

/** A line: a topic's spine, a tangent's curve from its point, the dashed thread to a point placed elsewhere, the dashed
 *  run on to a slot, or a margin note's string from its words. */
export interface Link {
  key: string;
  kind: "spine" | "branch" | "pulled" | "slot" | "note";
  from: End;
  to: End;
  room?: string;
  topic?: string;
  /** A straight run along the start's row, to this x (from the start item's left), before the curve: it keeps the curve
   *  out of the column's words, in the gutter. */
  lead?: number;
}

export interface Shelved {
  id: string;
  kind: "thread" | "point";
  thread: string;
  text: string;
  room?: string;
  at_ms: number;
}

export interface Layout {
  items: Item[];
  links: Link[];
  byKey: Map<string, Item>;
  /** Each thread's tip: what the view follows while it's yours (its latest point shown, else its card or head). */
  tips: Map<string, string>;
  /** The slots open under a thread's tip, in order: what the view keeps in sight with the tip. */
  slots: Map<string, string[]>;
  /** What's on the shelf, newest first. */
  shelf: Shelved[];
  /** Topics laid out in a row, in order (not those placed by hand). */
  lanes: string[];
  /** The named topics' groups, left to right: each its name ("" for the ones not sorted yet) and the band its header
   *  and columns take (what a spine is dropped on to move it there). None until two or more are named. */
  groups: { name: string; box: Box }[];
}

/** A margin note as the layout takes it (index.tsx gathers them from the map). */
export interface MarginInput {
  id: string;
  /** The point's thought its words are in. */
  thoughtId: string;
  /** The words, as picked. */
  quote: string;
  /** The note, then its replies, oldest first. */
  entries: readonly { by: string; text: string }[];
  /** It asks: folded to "…?" until opened. */
  question: boolean;
}

export interface LayoutInput {
  threads: readonly Thread[];
  thoughts: readonly Thought[];
  notes: Readonly<Record<string, Note>>;
  rooms: ReadonlyMap<string, string>;
  positions: Readonly<Record<string, Position>>;
  /** What's on this viewer's shelf, by id, with when it was put there: off the canvas. */
  shelf: ReadonlyMap<string, number>;
  /** The tangent shown open (its points), or none. */
  open: string | null;
  /** Who's at this window (the map's `me`). */
  me?: string;
  /** Everyone on the map (the map's `speakers`): which are AI participants (✦). */
  speakers?: ReadonlyMap<string, Speaker>;
  /** The thread you're on: its tip takes the slots, and it never floats as an aside. */
  active?: string | null;
  /** Your thoughts on their way, oldest first: a slot each under the active thread's tip. */
  slots?: readonly string[];
  paused?: ReadonlyMap<string, number>;
  /** The newest landing, by its thought, with the note it shows under the point until the next. */
  landing?: { thought: string; text: string } | null;
  /** Margin notes. */
  margins?: readonly MarginInput[];
  /** Folded questions this viewer opened. */
  opened?: ReadonlySet<string>;
  /** The map's topics in their order (the map's `topics`): the groups' order. Without it, the order they first come. */
  topics?: readonly string[];
  /** A phone's width: margin notes tuck under their words. */
  narrow?: boolean;
  staying?: string | null;
  originals?: ReadonlySet<string>;
}

/** One point: a thought, with the parts before a pause it carries on (chunks.tsx `asIdeas`: the card shows them as one,
 *  in the later one's words). Known by its first part, which stays the same as later parts join. */
export interface Idea {
  key: string;
  parts: Thought[];
  text: string;
  /** When its last part was said: its place in the order. */
  at: number;
  decided: boolean;
}

/** A thread's points, as its card shows them. */
export function ideasOf(thoughts: Thought[], notes: Readonly<Record<string, Note>>): Idea[] {
  const index = new Map(thoughts.map((t, i) => [t.id, i]));
  const headOf = (t: Thought) => {
    const id = notes[t.id]?.continues;
    const i = id ? index.get(id) : undefined;
    return i !== undefined && i < index.get(t.id)! ? thoughts[i] : undefined;
  };
  const carried = new Map<string, string>();
  for (const t of thoughts) {
    const head = headOf(t);
    if (head && !carried.has(head.id)) carried.set(head.id, t.id);
  }
  const ideas: Idea[] = [];
  for (const t of thoughts) {
    if (carried.has(t.id)) continue;
    const heads: Thought[] = [];
    for (let head = headOf(t); head && carried.get(head.id) === (heads[0] ?? t).id; head = headOf(head)) heads.unshift(head);
    const parts = [...heads, t];
    ideas.push({ key: parts[0].id, parts, text: (t.point || t.text).trim(), at: t.at_ms, decided: parts.some((p) => !!p.decided) });
  }
  return ideas;
}

const overlaps = (a: Box, b: Box, margin: number) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/** Everything placed so far, and the bottoms of the card columns. */
interface Scene {
  items: Item[];
  links: Link[];
  /** What's in the way of what comes next, with how much room to leave around it. */
  taken: { box: Box; margin: number }[];
  columns: Map<string, number>;
}
const scene = (): Scene => ({ items: [], links: [], taken: [], columns: new Map() });

/** `box` moved down until it clears everything in the way. */
function clear(s: Scene, box: Box): Box {
  let y = box.y;
  for (let moved = true, guard = 0; moved && guard < 1000; guard++) {
    moved = false;
    for (const { box: t, margin } of s.taken) {
      if (overlaps({ ...box, y }, t, margin)) {
        y = t.y + t.h + margin;
        moved = true;
      }
    }
  }
  return { ...box, y };
}

/** A point's shape: its words as shown and wrapped, the words with margin notes, what's under them, and its height. */
interface Shape {
  shown: string;
  lines: number[];
  quotes: Quote[];
  /** Where each open margin note's words end: the line, and how far along it. */
  ends: Map<string, { line: number; x: number }>;
  tucks: Tuck[];
  /** Margin notes beside it, open. */
  beside: MarginInput[];
  chips: boolean;
  landing?: string;
  h: number;
}

/** What's under a point's words, in px: the marks row, the landing note, tucked notes. */
const tuckHeight = (tucks: Tuck[]) =>
  tucks.reduce((h, tuck) => h + G.tuckTop + (tuck.title ? G.recapLine : 0) + tuck.entries.reduce((sum, e) => sum + Math.max(1, e.lines.length) * G.marginLine, 0)
    + 4 * Math.max(0, tuck.entries.length - 1), 0);

export function layout(input: LayoutInput): Layout {
  const { threads, notes, rooms, positions, open } = input;
  const me = input.me ?? "you";
  const who = (name: string) => whoIs(name, me, input.speakers);
  const active = input.active ?? null;
  const pendingSlots = input.slots ?? [];
  const opened = input.opened ?? new Set<string>();
  const narrow = !!input.narrow;
  const byId = new Map(threads.map((t) => [t.id, t]));
  const order = new Map(threads.map((t, i) => [t.id, i]));

  // Each thread's points, oldest first.
  const said = new Map<string, Thought[]>();
  for (const t of input.thoughts) {
    if (!t.placed || !t.thread_id || !byId.has(t.thread_id)) continue;
    const list = said.get(t.thread_id) ?? [];
    list.push(t);
    said.set(t.thread_id, list);
  }
  const ideas = new Map<string, Idea[]>();
  for (const [id, list] of said) ideas.set(id, id === input.staying ? ideasOf(list, {}) : ideasOf([...list].sort((a, b) => a.at_ms - b.at_ms), notes));
  const ideasIn = (id: string) => ideas.get(id) ?? [];
  const ideaOwner = new Map<string, { idea: Idea; thread: string }>();
  // A point is known by its first thought; a place given for any of its thoughts is its place.
  const partOf = new Map<string, string>();
  for (const [thread, list] of ideas) for (const idea of list) {
    ideaOwner.set(idea.key, { idea, thread });
    for (const part of idea.parts) partOf.set(part.id, idea.key);
  }
  // When a thread started: its first point, or when it was made if it has none yet.
  const started = (t: Thread) => {
    const first = ideasIn(t.id).reduce((at, idea) => Math.min(at, idea.parts[0].at_ms), Infinity);
    return Number.isFinite(first) ? first : t.touched_ms;
  };
  const byStart = (a: Thread, b: Thread) => started(a) - started(b) || order.get(a.id)! - order.get(b.id)!;

  // A thread's parent, if it's on the map and the chain up from it never loops.
  const parentOf = (t: Thread): string | null => {
    const seen = new Set([t.id]);
    for (let p = t.parent_id; p && byId.has(p); p = byId.get(p)!.parent_id) {
      if (seen.has(p)) return null;
      seen.add(p);
    }
    return t.parent_id && byId.has(t.parent_id) ? t.parent_id : null;
  };
  const kids = new Map<string, Thread[]>();
  const roots: Thread[] = [];
  for (const t of threads) {
    const p = parentOf(t);
    if (p) kids.set(p, [...(kids.get(p) ?? []), t]);
    else roots.push(t);
  }
  for (const list of kids.values()) list.sort(byStart);
  roots.sort(byStart);
  const depthOf = (t: Thread) => { let d = 0; for (let p = parentOf(t); p; p = parentOf(byId.get(p)!)) d++; return d; };
  const topicOf = (thread: string) => { let t = byId.get(thread)!; for (let p = parentOf(t); p; p = parentOf(t)) t = byId.get(p)!; return t.id; };

  // What was placed by hand, and what's on the shelf; either for something no longer on the map is left out.
  const known = (id: string) => byId.has(id) || ideaOwner.has(id);
  const shelved = new Map([...input.shelf].filter(([id]) => known(id)));
  const pins = new Map<string, Position>();
  for (const [given, p] of Object.entries(positions)) {
    const id = partOf.get(given) ?? given;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !known(id) || shelved.has(id)) continue;
    if ((pins.get(id)?.at_ms ?? -Infinity) <= p.at_ms) pins.set(id, p);
  }

  // Margin notes, by the point their words are in.
  const marginsOn = new Map<string, MarginInput[]>();
  for (const m of input.margins ?? []) {
    const key = partOf.get(m.thoughtId);
    if (key && m.entries.length) marginsOn.set(key, [...(marginsOn.get(key) ?? []), m]);
  }
  const landingOn = input.landing ? partOf.get(input.landing.thought) : undefined;

  // On a narrow screen a short tangent off a topic (two points or fewer, nothing off it, shut, not the one you're on)
  // tucks under the point it came from instead of hanging beside it, off the screen.
  const tuckedOn = new Map<string, Thread[]>();
  const tucked = new Set<string>();
  if (narrow) for (const t of threads) {
    const parent = parentOf(t);
    if (!parent || parentOf(byId.get(parent)!) || kids.get(t.id)?.length || ideasIn(t.id).length > G.noteMax || open === t.id || t.id === active || pins.has(t.id) || shelved.has(t.id)) continue;
    const start = started(t);
    const list = ideasIn(parent);
    const origin = [...list].reverse().find((idea) => idea.at <= start) ?? list[0];
    if (!origin || pins.has(origin.key) || shelved.has(origin.key)) continue;
    tuckedOn.set(origin.key, [...(tuckedOn.get(origin.key) ?? []), t]);
    tucked.add(t.id);
  }

  /** A lone aside: one point, nothing off it, not the thread you're on, not left off or decided. */
  const lone = (t: Thread) => {
    const list = ideasIn(t.id);
    const idea = list[0];
    return list.length === 1 && !(kids.get(t.id)?.length) && t.id !== active && t.id !== input.staying && t.status !== "dropped" && !idea.decided && !idea.parts.some((p) => p.unclear) &&
      idea.parts.at(-1)!.complete && !input.originals?.has(idea.key) && !pins.has(idea.key) && !shelved.has(idea.key) && !marginsOn.has(idea.key) && landingOn !== idea.key;
  };

  // Sizes, before anything is placed.
  const headLines = (t: Thread) => wrap(t.title, "title", G.titleW, G.titleMax);
  const headHeight = (lines: number[]) => Math.max(G.tile, lines.length * G.titleLine + G.headMeta);
  const entryOf = (by: string, text: string, w: number, full = false): Entry => ({ who: who(by), text, lines: wrap(text, "small", w, full ? Infinity : G.marginMax) });
  const stayingOn = (idea: Idea) => ideaOwner.get(idea.key)?.thread === input.staying;
  const shapes = new Map<string, Shape>();
  const shapeOf = (idea: Idea, look: Look): Shape => {
    const cached = shapes.get(`${idea.key}|${look.variant}`);
    if (cached) return cached;
    const left = !idea.parts.at(-1)!.complete;
    const staying = stayingOn(idea);
    const wordsOpen = !!input.originals?.has(idea.key);
    const pending = idea.parts.some((p) => p.unclear);
    const words = wordsOpen ? idea.parts.map((p) => p.text).join("\n") : pending ? idea.parts.map((p) => p.text).join(" ") : staying ? trimFillers(idea.text).text || idea.text : idea.text;
    const shown = left && !wordsOpen ? `“${words.replace(/[\s.,;:…—–-]+$/u, "")}…”` : words;
    // Words with a margin note: found in the words as shown (its own case first), in order, never overlapping.
    const found: { m: MarginInput; start: number; end: number }[] = [];
    for (const m of marginsOn.get(idea.key) ?? []) {
      const quote = m.quote.trim();
      let start = quote ? shown.indexOf(quote) : -1;
      if (start < 0 && quote) start = shown.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
      if (start >= 0 && !found.some((f) => start < f.end && f.start < start + quote.length)) found.push({ m, start, end: start + quote.length });
      else if (start < 0) found.push({ m, start: -1, end: -1 });
    }
    found.sort((a, b) => a.start - b.start);
    const quotes: Quote[] = [];
    const ends = new Map<string, { line: number; x: number }>();
    const tucks: Shape["tucks"] = [];
    const beside: MarginInput[] = [];
    // What's measured: the words with each folded question's "…?" where it shows, after its words.
    let measured = "";
    let at = 0;
    for (const { m, start, end } of found) {
      const folded = !staying && m.question && !opened.has(m.id);
      if (start >= 0) {
        // The "…?" goes after the stop that ends the words, never between them and it.
        const fold = folded ? end + (/^[.,;:!?…)”’"]*/u.exec(shown.slice(end))?.[0].length ?? 0) : end;
        measured += shown.slice(at, fold);
        at = fold;
        quotes.push({ start, end, margin: m.id, folded, fold });
        if (folded) measured += " …?";
      }
      if (folded && start >= 0) continue;
      if (narrow || look.variant === "mini") {
        const w = look.textW - G.tuckIn - 26;
        tucks.push({ margin: m.id, entries: shownEntries(m, staying).map((e) => entryOf(e.by, e.text, w, staying)) });
      } else {
        beside.push(m);
        ends.set(m.id, start >= 0 ? wrapEnd(measured, look.font, look.textW, look.max) : { line: 0, x: -1 });
      }
    }
    measured += shown.slice(at);
    for (const t of tuckedOn.get(idea.key) ?? []) {
      const latest = ideasIn(t.id).at(-1)?.text ?? "";
      tucks.push({ margin: t.id, thread: t.id, title: t.title, entries: latest ? [entryOf(me, latest, look.textW - G.tuckIn - 26)] : [] });
    }
    // The ✦ after words the AI changed takes room on the line too.
    if (idea.parts.some((p) => p.fixed && p.heard && p.fixed !== p.heard)) measured += " ✦";
    const lines = wrap(measured, look.font, look.textW, (wordsOpen || pending) ? Infinity : look.max);
    const chips = idea.decided || left;
    const landing = landingOn === idea.key ? input.landing!.text : undefined;
    const pauseHeight = idea.parts.reduce((n,p)=>n+(input.paused?.get(p.id)??0),0)*44;
    const h = pauseHeight + lines.length * look.line + (staying || wordsOpen ? G.pointLine + G.pointGap : 0) + (chips ? G.chips : 0) + (landing ? G.landLine : 0) + tuckHeight(tucks);
    const shape = { shown, lines, quotes, ends, tucks, beside, chips, landing, h };
    shapes.set(`${idea.key}|${look.variant}`, shape);
    return shape;
  };
  /** A note's entries as shown: the note and its latest reply. */
  const shownEntries = (m: MarginInput, full = false) => (full || m.entries.length <= G.marginShown ? [...m.entries] : [m.entries[0], m.entries[m.entries.length - 1]]);
  const marginHeight = (entries: Entry[], more = 0) => entries.reduce((sum, e) => sum + Math.max(20, e.lines.length * G.marginLine), 0)
    + G.marginGap * (entries.length - 1) + (more > 0 ? G.marginMore : 0);
  const lookFor = (thread: string) => (byId.get(thread) && parentOf(byId.get(thread)!) ? MINI_LOOK : SPINE_LOOK);
  // While sides are decided, every card counts as closed and nothing as placed or shelved: opening, moving or shelving one
  // never sends another to the other side.
  let deciding = false;
  const isOpen = (t: Thread) => !deciding && open === t.id && !!parentOf(t);
  const slotsFor = (t: Thread) => (!deciding && t.id === active ? pendingSlots : []);
  const card = (t: Thread) => {
    const titleLines = wrap(t.title, "cardTitle", G.cardW - 2 * G.pad, G.cardTitleMax);
    const list = ideasIn(t.id);
    const last = list.at(-1);
    if (!isOpen(t)) {
      const latest = last ? last.text : "";
      const latestLines = latest ? wrap(latest, "small", G.cardW - 2 * G.pad, G.cardPointMax) : [];
      const h = G.pad + titleLines.length * G.cardTitleLine + (latestLines.length ? 4 + latestLines.length * G.smallLine : 0) + 4 + G.recapLine + G.pad;
      return { titleLines, latest, latestLines, h };
    }
    let h = G.pad + titleLines.length * G.cardTitleLine + 10;
    for (const idea of list) h += (pins.has(idea.key) || shelved.has(idea.key) ? G.notch : shapeOf(idea, MINI_LOOK).h) + 8;
    h += slotsFor(t).length * (G.slotH + 8);
    return { titleLines, latest: last?.text ?? "", latestLines: [], h: h - (list.length || slotsFor(t).length ? 8 : 0) + G.pad };
  };
  const asideSize = (idea: Idea) => {
    const lines = wrap(idea.text, "small", G.asideMax - 2 * G.asideIn, 2);
    return { lines, w: Math.ceil(Math.max(...lines) + 2 * G.asideIn + 4), h: lines.length * G.asideLine + 2 * G.asidePad };
  };

  const marksOf = (idea: Idea): Mark[] => {
    const marks: Mark[] = [];
    const fixed = idea.parts.find((p) => p.fixed && p.heard && p.fixed !== p.heard);
    if (fixed) marks.push({ kind: "fixed", text: `Heard “${fixed.heard}”, fixed to “${fixed.fixed}”` });
    if (idea.decided) marks.push({ kind: "decided", text: "Decided" });
    return marks;
  };

  const out = scene();
  const items = out.items;
  const byKey = new Map<string, Item>();
  const tips = new Map<string, string>();
  const slotKeys = new Map<string, string[]>();
  const add = (s: Scene, item: Item, margin = 0) => {
    s.items.push(item);
    if (s === out) byKey.set(item.key, item);
    if (item.look?.variant !== "mini") s.taken.push({ box: item.box, margin: Math.max(margin, item.pinned ? CLEAR : 0) });
    return item;
  };
  const speakersOf = (t: Thread): Who[] => {
    const seen = new Map<string, Who>();
    for (const idea of ideasIn(t.id)) for (const part of idea.parts) {
      const said = who(part.speaker || "you");
      if (!seen.has(said.name)) seen.set(said.name, said);
    }
    return [...seen.values()].sort((a, b) => Number(b.me) - Number(a.me) || Number(a.ai) - Number(b.ai));
  };
  const threadItem = (t: Thread, box: Box, kind: "head" | "card" | "aside", extra: Partial<Item>): Item => ({
    key: `t:${t.id}`, id: t.id, kind, thread: t.id, box, pinned: pins.has(t.id), by: pins.get(t.id)?.by, topic: topicOf(t.id),
    room: rooms.get(t.id), depth: depthOf(t), title: t.title, picture: t.picture, dropped: t.status === "dropped", group: t.topic ?? "", ...extra,
  });
  const pointItem = (idea: Idea, thread: string, box: Box, look: Look, up: string | undefined, depth: number): Item => {
    const shape = shapeOf(idea, look);
    const speaker = who(idea.parts[0].speaker || "you");
    // Who agreed, once the core says (`agreed_by`); until then a decision is "✓ Decided".
    const agreedBy = idea.parts.flatMap((p) => p.agreed_by ?? []);
    const agreed = [...new Map(agreedBy.map((name) => who(name)).map((w) => [w.name, w])).values()].sort((a, b) => Number(b.me) - Number(a.me));
    let offset = idea.parts.at(-1)!.complete || input.originals?.has(idea.key) ? 0 : 1; // Only a shortened thought has an opening quote.
    const fixes = idea.parts.flatMap((thought) => {
      const within = thought.unclear ? thought.text.toLocaleLowerCase().indexOf(thought.unclear.toLocaleLowerCase()) : -1;
      const found = within >= 0 ? [{ thought, start: offset + within }] : [];
      offset += thought.text.length + 1; // Parts shown together have one space between them.
      return found;
    });
    return {
      key: `p:${idea.key}`, id: idea.key, kind: "point", thread, box, pinned: pins.has(idea.key), by: pins.get(idea.key)?.by, up, topic: topicOf(thread),
      room: rooms.get(thread), depth, fixes, text: idea.text, shown: shape.shown, lines: shape.lines, look, decided: idea.decided,
      wordsOpen: stayingOn(idea) || input.originals?.has(idea.key) ? !!input.originals?.has(idea.key) : undefined,
      thoughts: idea.parts.map((p) => p.id), at: idea.at, marks: marksOf(idea), who: speaker.me ? undefined : speaker,
      agreed: idea.decided && agreed.length > 1 ? agreed : undefined, left: !idea.parts.at(-1)!.complete, chips: shape.chips,
      landing: shape.landing, quotes: shape.quotes.length ? shape.quotes : undefined, tucks: shape.tucks.length ? shape.tucks : undefined,
    };
  };

  // Where a tangent's curve starts, by the parent's point it came from: right of its words, or left of its dot.
  type Anchor = { right: End; left: End; rightLead?: number; leftLead?: number };
  type Parent = { key: string; anchors: Map<string, Anchor>; edge: Anchor; thread: Thread; owner: { key: string; x0: number; x1: number }; level: number; side?: Side };
  // Which side each tangent took: decided once, when its topic is first laid out (the dry run that measures the row),
  // and kept for the real one, so the shape measured is the shape drawn.
  const lastSide = new Map<string, Side>();
  const sides = new Map<string, Side>();
  /** A pinned card's tangents are laid out after everything else, beside it. */
  const pinnedCards: { t: Thread; parent: Parent | null }[] = [];
  const pulled: { idea: Idea; thread: string; from: End | null }[] = [];

  /** A thread's points down its line, from `y`: in the spine's column at `x`, or inside an open card; then a slot for
   *  each of your thoughts on its way, if it's the thread you're on. */
  function points(s: Scene, t: Thread, x: number, y: number, look: Look, up: string, depth: number, anchors: Map<string, Anchor>, fit: boolean) {
    const keys: string[] = [];
    const gap = look.variant === "spine" ? G.pointGap : 8;
    for (const idea of ideasIn(t.id)) {
      if (!deciding && (pins.has(idea.key) || shelved.has(idea.key))) {
        const at = { x, y, w: look.w, h: G.notch };
        const box = fit ? clear(s, at) : at;
        const notch = add(s, { key: `n:${idea.key}`, id: idea.key, kind: "notch", thread: t.id, box, pinned: false, up, room: rooms.get(t.id), depth, look, topic: topicOf(t.id) });
        const mid = G.notch / 2;
        anchors.set(idea.key, { left: { key: notch.key, dx: look.lineX - 4, dy: mid }, right: { key: notch.key, dx: look.lineX + 4, dy: mid }, rightLead: look.w + 8, leftLead: -8 });
        if (pins.has(idea.key) && s === out) pulled.push({ idea, thread: t.id, from: { key: notch.key, dx: look.lineX + 4, dy: mid } });
        keys.push(notch.key);
        y = box.y + box.h + gap;
        continue;
      }
      const shape = shapeOf(idea, look);
      const at = { x, y, w: look.w, h: shape.h };
      const box = fit ? clear(s, at) : at;
      const item = add(s, pointItem(idea, t.id, box, look, up, depth));
      const dot = look.line / 2;
      anchors.set(idea.key, {
        left: { key: item.key, dx: look.lineX - 6, dy: dot },
        right: { key: item.key, dx: Math.min(look.textX + shape.lines[0] + 8, look.w + 8), dy: dot },
        rightLead: look.w + 8, leftLead: -8,
      });
      keys.push(item.key);
      // A pinned conversation is rows: leave the full comment's height before the next thought.
      const besideHeight = t.id === input.staying ? shape.beside.reduce((height, m) => height + marginHeight(shownEntries(m, true)
        .map((e) => entryOf(e.by, e.text, G.marginText, true))) + G.stack, 0) : 0;
      y = box.y + Math.max(box.h, besideHeight) + gap;
    }
    const slots: string[] = [];
    for (const id of slotsFor(t)) {
      const at = { x, y, w: look.w, h: look.variant === "spine" ? G.slotH : G.smallLine + 6 };
      const box = fit ? clear(s, at) : at;
      const slot = add(s, { key: `s:${id}`, id, kind: "slot", thread: t.id, box, pinned: false, up, room: rooms.get(t.id), depth, look, topic: topicOf(t.id) });
      slots.push(slot.key);
      y = box.y + box.h + gap;
    }
    if (s === out && slots.length) slotKeys.set(t.id, slots);
    return { keys, slots, bottom: y };
  }

  /** The dashed run from a thread's last dot (or its head) on to its first slot. */
  function slotLink(s: Scene, t: Thread, from: End, slots: string[], look: Look) {
    const last = slots.length ? s.items.find((i) => i.key === slots.at(-1)) : undefined;
    if (!last) return;
    s.links.push({ key: `z:${t.id}`, kind: "slot", from, to: { key: last.key, dx: look.lineX, dy: last.box.h / 2 }, room: rooms.get(t.id), topic: topicOf(t.id) });
  }

  /** Margin notes beside a topic's points, in the right-hand column, level with their words, before tangents take it. */
  function margins(s: Scene, t: Thread, keys: string[], owner: Parent["owner"]) {
    if (deciding) return;
    for (const key of keys) {
      const point = s.items.find((i) => i.key === key);
      const owned = point?.kind === "point" ? ideaOwner.get(point.id) : undefined;
      if (!point || !owned) continue;
      const shape = shapeOf(owned.idea, SPINE_LOOK);
      for (const m of shape.beside) {
        const end = shape.ends.get(m.id)!;
        const from: End = end.x < 0
          ? { key: point.key, dx: Math.min(G.textX + shape.lines[0] + 8, G.colW + 8), dy: G.dotY }
          : { key: point.key, dx: G.textX + end.x + 3, dy: end.line * G.pointLine + G.pointLine / 2 + 2 };
        const staying = t.id === input.staying;
        const entries = shownEntries(m, staying).map((e) => entryOf(e.by, e.text, G.marginText, staying));
        const more = m.entries.length - entries.length;
        const h = marginHeight(entries, more);
        const column = columnKey(owner, 1, 1);
        const want = Math.max(point.box.y + (staying ? 0 : from.dy - 10), (s.columns.get(column) ?? -Infinity) + G.stack);
        const box = clear(s, { x: owner.x1 + G.gutter, y: want, w: G.marginW, h });
        const item = add(s, { key: `m:${m.id}`, id: m.id, kind: "margin", thread: t.id, box, pinned: false, up: point.key, room: rooms.get(t.id), depth: point.depth,
          topic: topicOf(t.id), margin: m.id, entries, more: more > 0 ? more : undefined });
        s.columns.set(column, box.y + box.h);
        s.links.push({ key: `q:${m.id}`, kind: "note", from, to: { key: item.key, dx: -4, dy: 10 }, room: rooms.get(t.id), topic: topicOf(t.id) });
      }
    }
  }

  /** A topic: its head at (x, y), its points, its margin notes and its tangents beside them; or, alone, an aside. */
  function spine(s: Scene, t: Thread, x: number, y: number, exact: boolean) {
    if (!deciding && lone(t)) {
      const idea = ideasIn(t.id)[0];
      const size = asideSize(idea);
      const at = { x, y, w: size.w, h: size.h };
      const box = exact ? at : clear(s, at);
      const speaker = who(idea.parts[0].speaker || "you");
      add(s, threadItem(t, box, "aside", { text: idea.text, shown: idea.text, lines: size.lines, thoughts: idea.parts.map((p) => p.id), at: idea.at, count: 1, since: idea.at,
        who: speaker.me ? undefined : speaker }));
      if (s === out) tips.set(t.id, `t:${t.id}`);
      return;
    }
    const lines = headLines(t);
    const at = { x, y, w: G.colW, h: headHeight(lines) };
    const box = exact ? at : clear(s, at);
    const head = add(s, threadItem(t, box, "head", { titleLines: lines, count: ideasIn(t.id).length, since: ideasIn(t.id).at(-1)?.at, speakers: speakersOf(t) }));
    const anchors = new Map<string, Anchor>();
    const shown = points(s, t, box.x, box.y + box.h + G.headGap, SPINE_LOOK, head.key, 0, anchors, true);
    const lastDot = (key: string): End => ({ key, dx: G.lineX, dy: key.startsWith("n:") ? G.notch / 2 : G.dotY });
    if (shown.keys.length) {
      const last = shown.keys.at(-1)!;
      s.links.push({ key: `s:${t.id}`, kind: "spine", from: { key: head.key, dx: G.lineX, dy: G.tile }, to: lastDot(last), room: rooms.get(t.id), topic: topicOf(t.id) });
      if (s === out) tips.set(t.id, last.startsWith("n:") ? head.key : last);
      slotLink(s, t, lastDot(last), shown.slots, SPINE_LOOK);
    } else {
      if (s === out) tips.set(t.id, head.key);
      slotLink(s, t, { key: head.key, dx: G.lineX, dy: G.tile }, shown.slots, SPINE_LOOK);
    }
    const owner = { key: head.key, x0: box.x, x1: box.x + G.colW };
    margins(s, t, shown.keys, owner);
    const titleEnd = G.titleX + Math.max(...lines.slice(0, 1), 0) + 8;
    const edge: Anchor = { left: { key: head.key, dx: 0, dy: G.tile / 2 }, right: { key: head.key, dx: Math.min(titleEnd, G.colW + 8), dy: G.tile / 2 }, rightLead: G.colW + 8, leftLead: -8 };
    tangents(s, { key: head.key, anchors, edge, thread: t, owner, level: 1 });
  }

  /** The column for tangents at `level` on `side` of `owner`'s column. */
  const columnX = (owner: Parent["owner"], side: Side, level: number) =>
    side > 0 ? owner.x1 + G.gutter + (level - 1) * (G.cardW + G.gutter) : owner.x0 - G.gutter - G.cardW - (level - 1) * (G.cardW + G.gutter);
  const columnKey = (owner: Parent["owner"], side: Side, level: number) => `${owner.key}|${side}|${level}`;
  const endY = (s: Scene, end: End) => {
    const item = s.items.find((i) => i.key === end.key);
    return item ? item.box.y + end.dy : 0;
  };
  const endX = (s: Scene, end: End) => {
    const item = s.items.find((i) => i.key === end.key);
    return item ? item.box.x + end.dx : 0;
  };

  /** Where a tangent of `parent` starts: the parent's latest point said before the tangent's first. */
  const originOf = (parent: Parent, t: Thread): Anchor => {
    const start = started(t);
    let found: Anchor | undefined;
    for (const idea of ideasIn(parent.thread.id)) if (idea.at <= start && parent.anchors.has(idea.key)) found = parent.anchors.get(idea.key);
    return found ?? parent.edge;
  };

  /** A parent's tangents, each in a card in its column, or where it was placed by hand. */
  function tangents(s: Scene, parent: Parent) {
    for (const t of kids.get(parent.thread.id) ?? []) {
      // One placed elsewhere or shelved still takes its turn: its siblings keep their sides when it leaves.
      const turn: Side = (lastSide.get(parent.key) ?? -1) > 0 ? -1 : 1;
      if (!deciding && (shelved.has(t.id) || tucked.has(t.id))) { lastSide.set(parent.key, sides.get(t.id) ?? turn); continue; }
      const origin = originOf(parent, t);
      if (!deciding && pins.has(t.id)) {
        lastSide.set(parent.key, sides.get(t.id) ?? turn);
        if (s === out) pinnedCards.push({ t, parent });
        continue;
      }
      const size = card(t);
      const wanted = (side: Side) => {
        const from = side > 0 ? origin.right : origin.left;
        return Math.max(endY(s, from) - CARD_ROW, (s.columns.get(columnKey(parent.owner, side, parent.level)) ?? -Infinity) + G.stack);
      };
      let side: Side = parent.side ?? sides.get(t.id) ?? ((lastSide.get(parent.key) ?? -1) > 0 ? -1 : 1);
      // Beside its point beats strict turns: if the other side would hold it two lines nearer, it goes there.
      if (!parent.side && !sides.has(t.id) && wanted(side) - wanted(-side as Side) > 2 * G.pointLine) side = -side as Side;
      sides.set(t.id, side);
      lastSide.set(parent.key, side);
      const box = clear(s, { x: columnX(parent.owner, side, parent.level), y: wanted(side), w: G.cardW, h: size.h });
      s.columns.set(columnKey(parent.owner, side, parent.level), box.y + box.h);
      placeCard(s, t, box, side, size, parent, origin);
    }
  }

  /** A tangent's card at `box`, its curve from `origin`, its points if open, and its own tangents further out. */
  function placeCard(s: Scene, t: Thread, box: Box, side: Side, size: ReturnType<typeof card>, parent: Parent | null, origin: Anchor | null) {
    const list = ideasIn(t.id);
    const item = add(s, threadItem(t, box, "card", {
      up: parent && !pins.has(t.id) ? parent.key : undefined, side, open: isOpen(t), titleLines: size.titleLines, latest: size.latest,
      latestLines: size.latestLines, count: list.length, since: list.at(-1)?.at, slim: !isOpen(t) && list.length <= G.noteMax && !(kids.get(t.id)?.length), tangents: kids.get(t.id)?.length,
    }));
    if (origin) {
      const from = side > 0 ? origin.right : origin.left;
      s.links.push({ key: `b:${t.id}`, kind: "branch", from, to: { key: item.key, dx: side > 0 ? 0 : G.cardW, dy: CARD_ROW }, room: rooms.get(t.id),
        lead: side > 0 ? origin.rightLead : origin.leftLead, topic: topicOf(t.id) });
    }
    const anchors = new Map<string, Anchor>();
    let tip = item.key;
    if (isOpen(t)) {
      const shown = points(s, t, box.x + MINI_LEFT, box.y + G.pad + size.titleLines.length * G.cardTitleLine + 10, MINI_LOOK, item.key, item.depth, anchors, false);
      const marks = [...shown.keys, ...shown.slots];
      if (marks.length) {
        const last = marks.at(-1)!;
        const lastItem = s.items.find((i) => i.key === last)!;
        item.line = { x: MINI_LEFT + MINI_LOOK.lineX, y1: G.pad + size.titleLines.length * G.cardTitleLine + 4,
          y2: lastItem.box.y - box.y + (last.startsWith("n:") ? G.notch / 2 : last.startsWith("s:") ? lastItem.box.h / 2 : MINI_LOOK.line / 2) };
        const lastPoint = shown.keys.at(-1);
        if (lastPoint && !lastPoint.startsWith("n:")) tip = lastPoint;
      }
    }
    if (s === out) tips.set(t.id, tip);
    // Its own tangents start from its points when open, else from its edge, beside its title.
    const outer = side > 0 ? G.cardW : 0;
    const edge: Anchor = { right: { key: item.key, dx: outer, dy: CARD_ROW }, left: { key: item.key, dx: outer, dy: CARD_ROW } };
    const nested: Parent = pins.has(t.id) || !parent
      ? { key: item.key, anchors, edge, thread: t, owner: { key: item.key, x0: box.x, x1: box.x + G.cardW }, level: 1, side }
      : { key: item.key, anchors, edge, thread: t, owner: parent.owner, level: parent.level + 1, side };
    tangents(s, nested);
  }

  // 1. What's placed by hand takes its place first: everything else goes around it.
  const pinnedTopics = roots.filter((t) => pins.has(t.id) && !shelved.has(t.id));
  const pinBox = (id: string, p: Position): Box => {
    const t = byId.get(id);
    if (t) {
      if (parentOf(t)) return { x: p.x, y: p.y, w: G.cardW, h: card(t).h };
      if (lone(t)) { const size = asideSize(ideasIn(t.id)[0]); return { x: p.x, y: p.y, w: size.w, h: size.h }; }
      return { x: p.x, y: p.y, w: G.colW, h: headHeight(headLines(t)) };
    }
    const owner = ideaOwner.get(id)!;
    return { x: p.x, y: p.y, w: lookFor(owner.thread).w, h: shapeOf(owner.idea, lookFor(owner.thread)).h };
  };
  for (const [id, p] of pins) out.taken.push({ box: pinBox(id, p), margin: CLEAR });
  // A topic placed by hand keeps its whole shape out of the columns' way; anything else placed, its own box. Each knows
  // its topic: a topic's own pieces never push the topic itself (moved beside its spine, a point stays its neighbour; the
  // points below it make room, nothing jumps).
  const keepOut: { box: Box; topic: string }[] = [];
  for (const [id, p] of pins) {
    const topic = topicOf(byId.has(id) ? id : ideaOwner.get(id)!.thread);
    if (!pinnedTopics.some((t) => t.id === id)) { keepOut.push({ box: pinBox(id, p), topic }); continue; }
    const dry = scene();
    spine(dry, byId.get(id)!, p.x, p.y, true);
    keepOut.push({ box: bounds(dry.items.map((i) => i.box)), topic });
  }

  // Sides first, every card closed, for every topic: what's opened later changes heights, never sides.
  deciding = true;
  for (const t of roots) if (!shelved.has(t.id)) spine(scene(), t, 0, 0, true);
  deciding = false;
  lastSide.clear();

  // 2. The columns: each topic, in the order they started, goes under the column that was shortest then (counting only
  //    what had been said by that moment), so a topic never changes column; under it, topics stand as tall as they are
  //    now. Spines in a column line up; a column is as wide as its widest topic; past anything placed by hand.
  const lanes: string[] = [];
  const rows = new Map<string, { shape: Box; history: { at: number; bottom: number }[]; head: number }>();
  const order2: Thread[] = roots.filter((t) => !pins.has(t.id) && !shelved.has(t.id));
  for (const t of order2) {
    const dry = scene();
    spine(dry, t, 0, 0, true);
    const shape = bounds(dry.items.map((i) => i.box));
    const history = dry.items.filter((i) => i.kind === "point" && i.look?.variant === "spine" && i.at !== undefined)
      .map((i) => ({ at: i.at!, bottom: i.box.y + i.box.h })).sort((a, b) => a.at - b.at);
    rows.set(t.id, { shape, history, head: dry.items[0]?.box.h ?? G.tile });
  }
  const heightAt = (id: string, moment: number) => {
    const { history, head } = rows.get(id)!;
    let bottom = head;
    for (const step of history) if (step.at <= moment) bottom = Math.max(bottom, step.bottom);
    return bottom;
  };
  /** `ts`, each in the order they started, under the one of `n` columns that was shortest then. */
  const masonry = (ts: Thread[], n: number) => {
    const columns: string[][] = Array.from({ length: n }, () => []);
    for (const t of ts) {
      const moment = started(t);
      let best = 0;
      let lowest = Infinity;
      columns.forEach((list, c) => {
        const bottom = list.reduce((sum, id) => sum + heightAt(id, moment) + G.rowGap, 0);
        if (bottom < lowest - 0.5) { lowest = bottom; best = c; }
      });
      columns[best].push(t.id);
    }
    return columns;
  };
  // Groups: each named topic in the map's order, then those not sorted yet, once two or more are named among the topics
  // laid out here; else one group of every topic, in six columns, as before.
  const named = [...new Set([...(input.topics ?? []), ...roots.map((t) => t.topic).filter((name): name is string => !!name)])]
    .filter((name) => order2.some((t) => t.topic === name));
  const grouped = named.length >= 2;
  const groupsIn: { name: string; ts: Thread[] }[] = grouped
    ? [...named.map((name) => ({ name, ts: order2.filter((t) => t.topic === name) })), { name: "", ts: order2.filter((t) => !t.topic || !named.includes(t.topic)) }].filter((g) => g.ts.length)
    : [{ name: "", ts: order2 }];
  const groups: Layout["groups"] = [];
  let x0 = 0;
  for (const group of groupsIn) {
    const groupX = x0;
    let bottomMost = 0;
    const columns = masonry(group.ts, grouped ? Math.ceil(group.ts.length / G.perColumn) : G.columns);
    for (const list of columns) {
      if (!list.length) continue;
      const left = Math.max(...list.map((id) => -rows.get(id)!.shape.x));
      const right = Math.max(...list.map((id) => rows.get(id)!.shape.x + rows.get(id)!.shape.w));
      const spineX = x0 + left;
      let y = 0;
      for (const id of list) {
        const { shape } = rows.get(id)!;
        // Past anything placed by hand that's in the way: down, keeping the column.
        let top = y;
        for (let moved = true, guard = 0; moved && guard < 100; guard++) {
          moved = false;
          for (const { box: k, topic } of keepOut) {
            if (topic !== id && overlaps({ x: spineX + shape.x, y: top + shape.y, w: shape.w, h: shape.h }, k, G.laneGap / 2)) {
              top = k.y + k.h + G.laneGap - shape.y;
              moved = true;
            }
          }
        }
        const before = out.items.length;
        spine(out, byId.get(id)!, spineX, top, false);
        let bottom = top;
        for (const item of out.items.slice(before)) bottom = Math.max(bottom, item.box.y + item.box.h);
        const above = lanes.length && list.indexOf(id) > 0 ? byKey.get(`t:${list[list.indexOf(id) - 1]}`) : undefined;
        if (above) above.reach = top - above.box.y;
        lanes.push(id);
        bottomMost = Math.max(bottomMost, bottom);
        y = bottom + G.rowGap;
      }
      x0 = spineX + right + G.laneGap;
    }
    if (grouped) {
      // Its header: over its columns, its name and how many topics (spines) it holds; what a spine is dropped on to join it.
      const w = Math.max(G.colW, x0 - G.laneGap - groupX);
      const box = { x: groupX, y: -G.groupHead - G.groupGap, w, h: G.groupHead };
      // Every spine under it counts, those placed by hand or on the shelf too.
      const count = roots.filter((t) => (group.name ? t.topic === group.name : !t.topic || !named.includes(t.topic))).length;
      add(out, { key: `g:${group.name}`, id: `g:${group.name}`, kind: "group", thread: "", box, pinned: false, depth: 0, topic: "", title: group.name, count, group: group.name });
      groups.push({ name: group.name, box: { x: groupX, y: box.y, w, h: bottomMost - box.y } });
      x0 += G.groupSpace;
    }
  }

  // 3. What's placed by hand, with what flows from it: a topic's points and tangents, a card's tangents, a point.
  for (const t of pinnedTopics) spine(out, t, pins.get(t.id)!.x, pins.get(t.id)!.y, true);
  for (let i = 0; i < pinnedCards.length; i++) {
    const { t, parent } = pinnedCards[i];
    const p = pins.get(t.id)!;
    const size = card(t);
    const box = { x: p.x, y: p.y, w: G.cardW, h: size.h };
    const origin = parent ? originOf(parent, t) : null;
    const side: Side = origin && endX(out, origin.right) > box.x + G.cardW / 2 ? -1 : 1;
    placeCard(out, t, box, side, size, parent, origin);
  }
  // A tangent placed by hand whose parent isn't shown (on the shelf, or folded away inside a closed card) still shows.
  for (const [id, p] of pins) {
    const t = byId.get(id);
    if (!t || !parentOf(t) || byKey.has(`t:${id}`) || shelved.has(id)) continue;
    const size = card(t);
    placeCard(out, t, { x: p.x, y: p.y, w: G.cardW, h: size.h }, 1, size, null, null);
  }
  // A point placed by hand: exactly there, with a dashed line back to where it was said, if that's shown.
  const pulledFrom = new Map(pulled.map((entry) => [entry.idea.key, entry.from]));
  for (const [id, p] of pins) {
    const owner = ideaOwner.get(id);
    if (!owner) continue;
    const look = lookFor(owner.thread);
    const item = add(out, pointItem(owner.idea, owner.thread, { x: p.x, y: p.y, w: look.w, h: shapeOf(owner.idea, look).h }, look, undefined, depthOf(byId.get(owner.thread)!)));
    const shown = byKey.get(`t:${owner.thread}`);
    const from = pulledFrom.get(id) ?? (shown ? { key: shown.key, dx: shown.kind === "card" && shown.side !== 1 ? G.cardW : 0, dy: shown.kind === "card" ? CARD_ROW : G.tile / 2 } : null);
    if (from) out.links.push({ key: `l:${id}`, kind: "pulled", from, to: { key: item.key, dx: look.lineX - 6, dy: look.line / 2 }, room: rooms.get(owner.thread), topic: topicOf(owner.thread) });
  }

  // The shelf, newest first.
  const shelf: Shelved[] = [];
  for (const [id, at_ms] of shelved) {
    const t = byId.get(id);
    if (t) shelf.push({ id, kind: "thread", thread: id, text: t.title, room: rooms.get(id), at_ms });
    else {
      const owner = ideaOwner.get(id)!;
      shelf.push({ id, kind: "point", thread: owner.thread, text: owner.idea.text, room: rooms.get(owner.thread), at_ms });
    }
  }
  shelf.sort((a, b) => b.at_ms - a.at_ms);
  // A link whose end isn't shown goes too (an origin on the shelf).
  const links = out.links.filter((link) => byKey.has(link.from.key) && byKey.has(link.to.key));
  return { items, links, byKey, tips, slots: slotKeys, shelf, lanes, groups };
}

/** The smallest box around `boxes`. */
export function bounds(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}
