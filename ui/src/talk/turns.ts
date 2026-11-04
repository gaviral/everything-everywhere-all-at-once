// The Talk tab's turns: what was said, as messages, from the journal's thoughts (every turn is one), and how far each
// person has read them. Pure, so scripts/call-check.mjs runs it without a browser; Talk.tsx draws it.
import { readMs } from "../attention-core";
import type { Turn } from "../bricks/contract";
export { turnsOf } from "../bricks/contract";
export type { Part, Turn } from "../bricks/contract";

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
 *  `readMs`), and never under the canvas read marker's dwell (1.5 s), so a glance while scrolling past isn't reading. */
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
