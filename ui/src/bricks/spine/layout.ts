// Where everything goes on the Spine (index.tsx draws it), from the map alone. Pure: the same map, placements and
// choices give the same places, and what a new thought adds goes below or beside what's there.
//  - A topic (a thread with no parent) is a spine: its head (picture, title), then its points down a line, oldest
//    first. Topics stand side by side in the order they started, apart: unrelated until someone connects them.
//  - A tangent (a branch) hangs beside the point it came from, the parent's latest point when it started; tangents
//    alternate right and left, and a tangent's own go further out on its side. Each is a card: title, latest point
//    and a recap line; open, its points as a small spine of their own.
//  - Whatever someone placed by hand stays exactly there; the rest flows around it, never under it. What's on the
//    shelf is off the canvas; where a point was, its line keeps a small mark.
import type { Note, Position, Thought, Thread } from "../contract";
import { wrap, type FontKey } from "./measure";

export type Box = { x: number; y: number; w: number; h: number };
export type Side = 1 | -1;

/** Sizes in the canvas's own units (px at zoom 1). */
export const G = {
  // A topic's column: the line at 16 (the middle of its 32 px tile), words from 40. The measure, 256, holds 98% of
  // points in two lines at 15 px (median 44 characters, p98 61, max 70; five sample maps and a live one, n = 234).
  lineX: 16, tile: 32, textX: 40, textW: 256, colW: 296,
  // The head's title, 17/22 beside the tile, up to three lines (titles: median 22 characters, max 42).
  titleX: 44, titleW: 252, titleLine: 22, titleMax: 3,
  // Points at 15/22, up to three lines, 12 apart, the first 16 under the head; a point's dot sits on its first line.
  pointLine: 22, pointMax: 3, pointGap: 12, headGap: 16, dotY: 11,
  // Where a point now placed elsewhere, or shelved, was: a small hollow mark that keeps the line's order.
  notch: 14,
  // A tangent's card: 232 wide (26 characters of its 15 px title a line, so most titles take one), 12 inside; its
  // latest point at 13/18, up to two lines; a recap line at 12/16.
  cardW: 232, pad: 12, cardTitleLine: 20, cardTitleMax: 2, smallLine: 18, cardPointMax: 2, recapLine: 16,
  // The gutter between a column and its cards holds the curve from a point to its card; topics stand twice that
  // apart, so a topic's own cards read as its own (closer = belongs together).
  gutter: 48, laneGap: 96, stack: 12,
  // Topics stand in six columns, each new one under the column that was shortest when it started (a masonry): a live
  // map of 37 threads (Nov 2) then fits a 1440 × 900 window at zoom ≈ 0.4, where titles still read, instead of one
  // strip 12,800 units long (rows of four made it 6,200 tall: zoom 0.1). Under each other, topics keep the same gap
  // as side by side.
  columns: 6, rowGap: 96,
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

export type Kind = "head" | "point" | "card" | "notch";

/** A thing on the canvas. */
export interface Item {
  /** The canvas's id for it: "t:" a thread (head or card), "p:" a point, "n:" where a point was. */
  key: string;
  /** What `positions` knows it by: a thread's id, or a point's first thought's. */
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
  /** A topic's head: how far down the canvas is its own before the next topic under it starts (its title, far out,
   *  takes no more lines than fit there). */
  reach?: number;
  side?: Side;
  // A head or a card.
  title?: string;
  titleLines?: number[];
  picture?: string | null;
  dropped?: boolean;
  open?: boolean;
  count?: number;
  latest?: string;
  latestLines?: number[];
  since?: number;
  /** An open card's own small line, from under its title to its last point's dot, in its own coordinates (drawn by the
   *  card: the canvas's lines go under cards). */
  line?: { x: number; y1: number; y2: number };
  // A point.
  text?: string;
  lines?: number[];
  look?: Look;
  decided?: boolean;
  /** Every thought it holds: a landing on any of them is a landing on it. */
  thoughts?: string[];
  at?: number;
  /** What the AI did here (corrected the words, saw a decision): the hook for notices on the line (later). */
  marks?: Mark[];
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

/** A line: a topic's spine, a tangent's curve from its point, or the dashed thread to a point placed elsewhere. */
export interface Link {
  key: string;
  kind: "spine" | "branch" | "pulled";
  from: End;
  to: End;
  room?: string;
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
  /** What's on the shelf, newest first. */
  shelf: Shelved[];
  /** Topics laid out in a row, in order (not those placed by hand). */
  lanes: string[];
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

export function layout(input: LayoutInput): Layout {
  const { threads, notes, rooms, positions, open } = input;
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
  for (const [id, list] of said) ideas.set(id, ideasOf([...list].sort((a, b) => a.at_ms - b.at_ms), notes));
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

  // What was placed by hand, and what's on the shelf; either for something no longer on the map is left out.
  const known = (id: string) => byId.has(id) || ideaOwner.has(id);
  const shelved = new Map([...input.shelf].filter(([id]) => known(id)));
  const pins = new Map<string, Position>();
  for (const [given, p] of Object.entries(positions)) {
    const id = partOf.get(given) ?? given;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !known(id) || shelved.has(id)) continue;
    if ((pins.get(id)?.at_ms ?? -Infinity) <= p.at_ms) pins.set(id, p);
  }

  // Sizes, before anything is placed.
  const headLines = (t: Thread) => wrap(t.title, "title", G.titleW, G.titleMax);
  const headHeight = (lines: number[]) => Math.max(G.tile, lines.length * G.titleLine);
  const pointLines = (idea: Idea, look: Look) => wrap(idea.text, look.font, look.textW, look.max);
  const lookFor = (thread: string) => (byId.get(thread) && parentOf(byId.get(thread)!) ? MINI_LOOK : SPINE_LOOK);
  // While sides are decided, every card counts as closed and nothing as placed or shelved: opening, moving or shelving one
  // never sends another to the other side.
  let deciding = false;
  const isOpen = (t: Thread) => !deciding && open === t.id && !!parentOf(t);
  const card = (t: Thread) => {
    const titleLines = wrap(t.title, "cardTitle", G.cardW - 2 * G.pad, G.cardTitleMax);
    const list = ideasIn(t.id);
    const last = list.at(-1);
    if (!isOpen(t)) {
      const latest = last ? last.text : "";
      const latestLines = latest ? wrap(latest, "small", G.cardW - 2 * G.pad, G.cardPointMax) : [];
      const h = G.pad + titleLines.length * G.cardTitleLine + (latestLines.length ? 4 + latestLines.length * G.smallLine : 0) + 6 + G.recapLine + G.pad;
      return { titleLines, latest, latestLines, h };
    }
    let h = G.pad + titleLines.length * G.cardTitleLine + 10;
    for (const idea of list) h += (pins.has(idea.key) || shelved.has(idea.key) ? G.notch : pointLines(idea, MINI_LOOK).length * G.smallLine) + 8;
    return { titleLines, latest: last?.text ?? "", latestLines: [], h: h - (list.length ? 8 : 0) + G.pad };
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
  const add = (s: Scene, item: Item, margin = 0) => {
    s.items.push(item);
    if (s === out) byKey.set(item.key, item);
    if (item.look?.variant !== "mini") s.taken.push({ box: item.box, margin: Math.max(margin, item.pinned ? CLEAR : 0) });
    return item;
  };
  const threadItem = (t: Thread, box: Box, kind: "head" | "card", extra: Partial<Item>): Item => ({
    key: `t:${t.id}`, id: t.id, kind, thread: t.id, box, pinned: pins.has(t.id), by: pins.get(t.id)?.by,
    room: rooms.get(t.id), depth: depthOf(t), title: t.title, picture: t.picture, dropped: t.status === "dropped", ...extra,
  });
  const pointItem = (idea: Idea, thread: string, box: Box, look: Look, up: string | undefined, depth: number): Item => ({
    key: `p:${idea.key}`, id: idea.key, kind: "point", thread, box, pinned: pins.has(idea.key), by: pins.get(idea.key)?.by, up,
    room: rooms.get(thread), depth, text: idea.text, lines: pointLines(idea, look), look, decided: idea.decided,
    thoughts: idea.parts.map((p) => p.id), at: idea.at, marks: marksOf(idea),
  });

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

  /** A thread's points down its line, from `y`: in the spine's column at `x`, or inside an open card. */
  function points(s: Scene, t: Thread, x: number, y: number, look: Look, up: string, depth: number, anchors: Map<string, Anchor>, fit: boolean) {
    const keys: string[] = [];
    for (const idea of ideasIn(t.id)) {
      if (!deciding && (pins.has(idea.key) || shelved.has(idea.key))) {
        const at = { x, y, w: look.w, h: G.notch };
        const box = fit ? clear(s, at) : at;
        const notch = add(s, { key: `n:${idea.key}`, id: idea.key, kind: "notch", thread: t.id, box, pinned: false, up, room: rooms.get(t.id), depth, look });
        const mid = G.notch / 2;
        anchors.set(idea.key, { left: { key: notch.key, dx: look.lineX - 4, dy: mid }, right: { key: notch.key, dx: look.lineX + 4, dy: mid }, rightLead: look.w + 8, leftLead: -8 });
        if (pins.has(idea.key) && s === out) pulled.push({ idea, thread: t.id, from: { key: notch.key, dx: look.lineX + 4, dy: mid } });
        keys.push(notch.key);
        y = box.y + box.h + (look.variant === "spine" ? G.pointGap : 8);
        continue;
      }
      const lines = pointLines(idea, look);
      const at = { x, y, w: look.w, h: lines.length * look.line };
      const box = fit ? clear(s, at) : at;
      const item = add(s, pointItem(idea, t.id, box, look, up, depth));
      const dot = look.line / 2;
      anchors.set(idea.key, {
        left: { key: item.key, dx: look.lineX - 6, dy: dot },
        right: { key: item.key, dx: Math.min(look.textX + lines[0] + 8, look.w + 8), dy: dot },
        rightLead: look.w + 8, leftLead: -8,
      });
      keys.push(item.key);
      y = box.y + box.h + (look.variant === "spine" ? G.pointGap : 8);
    }
    return { keys, bottom: y };
  }

  /** A topic: its head at (x, y), its points, and its tangents beside them. */
  function spine(s: Scene, t: Thread, x: number, y: number, exact: boolean) {
    const lines = headLines(t);
    const at = { x, y, w: G.colW, h: headHeight(lines) };
    const box = exact ? at : clear(s, at);
    const head = add(s, threadItem(t, box, "head", { titleLines: lines, count: ideasIn(t.id).length, since: ideasIn(t.id).at(-1)?.at }));
    const anchors = new Map<string, Anchor>();
    const shown = points(s, t, box.x, box.y + box.h + G.headGap, SPINE_LOOK, head.key, 0, anchors, true);
    if (shown.keys.length) {
      const last = shown.keys.at(-1)!;
      s.links.push({ key: `s:${t.id}`, kind: "spine", from: { key: head.key, dx: G.lineX, dy: G.tile }, to: { key: last, dx: G.lineX, dy: last.startsWith("n:") ? G.notch / 2 : G.dotY }, room: rooms.get(t.id) });
      if (s === out) tips.set(t.id, last.startsWith("n:") ? head.key : last);
    } else if (s === out) tips.set(t.id, head.key);
    const titleEnd = G.titleX + Math.max(...lines.slice(0, 1), 0) + 8;
    const edge: Anchor = { left: { key: head.key, dx: 0, dy: G.tile / 2 }, right: { key: head.key, dx: Math.min(titleEnd, G.colW + 8), dy: G.tile / 2 }, rightLead: G.colW + 8, leftLead: -8 };
    tangents(s, { key: head.key, anchors, edge, thread: t, owner: { key: head.key, x0: box.x, x1: box.x + G.colW }, level: 1 });
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
      if (!deciding && shelved.has(t.id)) { lastSide.set(parent.key, sides.get(t.id) ?? turn); continue; }
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
      latestLines: size.latestLines, count: list.length, since: list.at(-1)?.at,
    }));
    if (origin) {
      const from = side > 0 ? origin.right : origin.left;
      s.links.push({ key: `b:${t.id}`, kind: "branch", from, to: { key: item.key, dx: side > 0 ? 0 : G.cardW, dy: CARD_ROW }, room: rooms.get(t.id),
        lead: side > 0 ? origin.rightLead : origin.leftLead });
    }
    const anchors = new Map<string, Anchor>();
    let tip = item.key;
    if (isOpen(t)) {
      const shown = points(s, t, box.x + MINI_LEFT, box.y + G.pad + size.titleLines.length * G.cardTitleLine + 10, MINI_LOOK, item.key, item.depth, anchors, false);
      if (shown.keys.length) {
        const last = shown.keys.at(-1)!;
        const lastItem = s.items.find((i) => i.key === last)!;
        item.line = { x: MINI_LEFT + MINI_LOOK.lineX, y1: G.pad + size.titleLines.length * G.cardTitleLine + 4,
          y2: lastItem.box.y - box.y + (last.startsWith("n:") ? G.notch / 2 : MINI_LOOK.line / 2) };
        if (!last.startsWith("n:")) tip = last;
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
    if (t) return parentOf(t) ? { x: p.x, y: p.y, w: G.cardW, h: card(t).h } : { x: p.x, y: p.y, w: G.colW, h: headHeight(headLines(t)) };
    const owner = ideaOwner.get(id)!;
    const look = lookFor(owner.thread);
    return { x: p.x, y: p.y, w: look.w, h: pointLines(owner.idea, look).length * look.line };
  };
  for (const [id, p] of pins) out.taken.push({ box: pinBox(id, p), margin: CLEAR });
  // A topic placed by hand keeps its whole shape out of the columns' way; anything else placed, its own box. Each knows
  // its topic: a topic's own pieces never push the topic itself (moved beside its spine, a point stays its neighbour; the
  // points below it make room, nothing jumps).
  const topicOf = (thread: string) => { let t = byId.get(thread)!; for (let p = parentOf(t); p; p = parentOf(t)) t = byId.get(p)!; return t.id; };
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
  const shapes = new Map<string, { shape: Box; history: { at: number; bottom: number }[]; head: number }>();
  const order2: Thread[] = roots.filter((t) => !pins.has(t.id) && !shelved.has(t.id));
  for (const t of order2) {
    const dry = scene();
    spine(dry, t, 0, 0, true);
    const shape = bounds(dry.items.map((i) => i.box));
    const history = dry.items.filter((i) => i.kind === "point" && i.look?.variant === "spine" && i.at !== undefined)
      .map((i) => ({ at: i.at!, bottom: i.box.y + i.box.h })).sort((a, b) => a.at - b.at);
    shapes.set(t.id, { shape, history, head: dry.items[0]?.box.h ?? G.tile });
  }
  const heightAt = (id: string, moment: number) => {
    const { history, head } = shapes.get(id)!;
    let bottom = head;
    for (const step of history) if (step.at <= moment) bottom = Math.max(bottom, step.bottom);
    return bottom;
  };
  const columns: string[][] = Array.from({ length: G.columns }, () => []);
  for (const t of order2) {
    const moment = started(t);
    let best = 0;
    let lowest = Infinity;
    columns.forEach((list, c) => {
      const bottom = list.reduce((sum, id) => sum + heightAt(id, moment) + G.rowGap, 0);
      if (bottom < lowest - 0.5) { lowest = bottom; best = c; }
    });
    columns[best].push(t.id);
  }
  let x0 = 0;
  for (const list of columns) {
    if (!list.length) continue;
    const left = Math.max(...list.map((id) => -shapes.get(id)!.shape.x));
    const right = Math.max(...list.map((id) => shapes.get(id)!.shape.x + shapes.get(id)!.shape.w));
    const spineX = x0 + left;
    let y = 0;
    for (const id of list) {
      const { shape } = shapes.get(id)!;
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
      y = bottom + G.rowGap;
    }
    x0 = spineX + right + G.laneGap;
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
    const lines = pointLines(owner.idea, look);
    const item = add(out, pointItem(owner.idea, owner.thread, { x: p.x, y: p.y, w: look.w, h: lines.length * look.line }, look, undefined, depthOf(byId.get(owner.thread)!)));
    const shown = byKey.get(`t:${owner.thread}`);
    const from = pulledFrom.get(id) ?? (shown ? { key: shown.key, dx: shown.kind === "card" && shown.side !== 1 ? G.cardW : 0, dy: shown.kind === "card" ? CARD_ROW : G.tile / 2 } : null);
    if (from) out.links.push({ key: `l:${id}`, kind: "pulled", from, to: { key: item.key, dx: look.lineX - 6, dy: look.line / 2 }, room: rooms.get(owner.thread) });
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
  return { items, links, byKey, tips, shelf, lanes };
}

/** The smallest box around `boxes`. */
export function bounds(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}
