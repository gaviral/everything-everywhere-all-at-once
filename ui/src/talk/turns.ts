// The Talk tab's turns: what was said, as messages, from the journal's thoughts (every turn is one), and how far each
// person has read them. Pure, so scripts/call-check.mjs runs it without a browser; Talk.tsx draws it.
import type { Anchor } from "../annotate-core";
import { readMs } from "../attention-core";
import type { Thought } from "../core";

/** One thought of a turn: a turn the placer cut in two is one turn of two parts, each its own point on the map. */
export interface Part {
  thoughtId: string;
  /** The words as said (the map shows the point made of them). */
  text: string;
  /** On a thread: a margin note can be tied to its words. */
  placed: boolean;
}

/** Something said, as Talk lists it. */
export interface Turn {
  /** Its first thought's id: the turn's key, and what a read mark names. */
  key: string;
  speaker: string;
  /** When it was said (ms since 1970, the core's clock). */
  at: number;
  parts: Part[];
  /** A margin note: the point's thought and the words it's tied to (a later note on the same words answers it). */
  note?: { threadId: string; thoughtId: string; quote: string };
}

/** The turns, in the order they were said: each thought with words, a split turn's parts together, a margin note as a
 *  turn of its own with the words it's on. `threads` with each note's `anchor`, as a brick's map holds them. */
export function turnsOf(thoughts: readonly Thought[], threads: readonly { id: string; anchor?: Anchor }[]): Turn[] {
  const anchors = new Map<string, Anchor>();
  for (const thread of threads) if (thread.anchor) anchors.set(thread.id, thread.anchor);
  const said = thoughts
    .map((thought, i) => ({ thought, i }))
    .filter(({ thought }) => (thought.text || thought.point).trim())
    .sort((a, b) => a.thought.at_ms - b.thought.at_ms || a.i - b.i);
  const turns: Turn[] = [];
  for (const { thought } of said) {
    const anchor = thought.thread_id ? anchors.get(thought.thread_id) : undefined;
    const part = { thoughtId: thought.id, text: (thought.text || thought.point).trim(), placed: thought.placed && !!thought.thread_id };
    const last = turns.at(-1);
    // The placer's cut keeps the turn's moment: the same speaker, said at the same time.
    if (!anchor && last && !last.note && last.speaker === thought.speaker && last.at === thought.at_ms) {
      last.parts.push(part);
      continue;
    }
    turns.push({
      key: thought.id, speaker: thought.speaker, at: thought.at_ms, parts: [part],
      ...(anchor ? { note: { threadId: thought.thread_id!, thoughtId: anchor.thought_id, quote: anchor.quote } } : {}),
    });
  }
  return turns;
}

/** Where thought `id` is among the turns (a part of a turn counts), or -1. */
export function turnIndex(turns: readonly Turn[], id: string | null | undefined): number {
  if (!id) return -1;
  return turns.findIndex((turn) => turn.parts.some((part) => part.thoughtId === id));
}

/** The newer of two read marks, by where they are among the turns; a mark not on the map counts for nothing. */
export function newerMark(turns: readonly Turn[], a: string | null | undefined, b: string | null | undefined): string | null {
  const [i, j] = [turnIndex(turns, a), turnIndex(turns, b)];
  if (i < 0 && j < 0) return null;
  return i >= j ? turns[i].key : turns[j].key;
}

/** The turns `me` hasn't read: after the mark (`read`, an index; -1 for none), said by someone else, from `from` on
 *  (the call's start: what came before it is the map's past, not news). */
export function unreadOf(turns: readonly Turn[], read: number, me: string, from: number): Turn[] {
  return turns.filter((turn, i) => i > read && turn.speaker !== me && turn.at >= from);
}

/** How long a turn must stay in view to count as read: its words at an average reader's pace (attention-core.ts
 *  `readMs`), and never under the Read progress brick's dwell (1.5 s), so a glance while scrolling past isn't reading. */
export const DWELL_MS = 1500;
export function readFor(turn: Turn): number {
  return Math.max(DWELL_MS, readMs(turn.parts.map((part) => part.text).join(" ")));
}

/** Where each other person has read up to, by turn index: their initial sits there. People who haven't said, and AI
 *  participants (they don't read a list), aren't shown. */
export function readersAt(turns: readonly Turn[], people: readonly { name: string; ai: boolean; read: string | null }[], me: string): Map<number, string[]> {
  const at = new Map<number, string[]>();
  for (const person of people) {
    if (person.ai || person.name === me) continue;
    const i = turnIndex(turns, person.read);
    if (i >= 0) at.set(i, [...(at.get(i) ?? []), person.name]);
  }
  return at;
}
