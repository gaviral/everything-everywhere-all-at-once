// What just changed and where to look, as one rule set for the whole map (decisions/attention.md): a landing's
// highlight, the "latest" mark, "New in X ↓", unseen marks and the "this" a spoken command points at. The timings
// come from reading, not from a clock: a highlight lasts as long as it takes to look over and read what it marks.
import type { World } from "./core";

/** Silent reading of English non-fiction, words per minute (Brysbaert 2019, a meta-analysis of 190 studies: 238). */
export const READ_WPM = 238;
/** The time the eye takes to start moving to something that appears (saccade latency, ≈ 200 ms). A cross-fade this
 *  short has finished by the time the eye arrives, so under Reduce Motion it never delays reading. */
export const LOOK_MS = 200;
/** How long a highlight or a "seen" check gives you to find and read `text`: one look over, then its words. */
export function readMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return LOOK_MS + Math.round((words * 60_000) / READ_WPM);
}

/** A thread changed while you weren't looking: the element that shows the change, and the words that say it. */
export type Unseen = { thread: string; element: string; line: string };

function resolve(world: World, id: string): string {
  for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[id]; hops--) id = world.merged[id];
  return id;
}

/** Threads that changed between two worlds, other than by your own words landing (your landing has its own
 *  highlight and the "latest" mark): someone else's thought, a thought moved in by a merge, a new proposal or
 *  suggestion, a new title. One per thread, its newest change. */
export function changes(before: World, after: World, me: string): Unseen[] {
  const out = new Map<string, Unseen>();
  const threads = new Set(after.threads.map((t) => t.id));
  const was = new Map(before.thoughts.map((t) => [t.id, t]));
  for (const thought of after.thoughts) {
    if (!thought.placed || !thought.thread_id) continue;
    const thread = resolve(after, thought.thread_id);
    const old = was.get(thought.id);
    const landed = !old?.placed;
    // Where it was, as the map showed it then: a merge may keep its thread id and only map it to the survivor.
    const moved = !landed && !!old!.thread_id && resolve(before, old!.thread_id) !== thread;
    if (!threads.has(thread) || !(landed || moved) || (landed && (thought.speaker === me || thought.speaker === "you"))) continue;
    out.set(thread, { thread, element: `point-${thought.id}`, line: thought.point || thought.text });
  }
  const items = <T extends { id: string; thread_id: string; status: string }>(list: T[], old: { id: string }[], text: (item: T) => string) => {
    const known = new Set(old.map((i) => i.id));
    for (const item of list) {
      const thread = resolve(after, item.thread_id);
      if (item.status === "new" && !known.has(item.id) && threads.has(thread)) out.set(thread, { thread, element: `item-${item.id}`, line: text(item) });
    }
  };
  items(after.suggestions, before.suggestions, (s) => s.text);
  items(after.actions, before.actions, (a) => a.title);
  const titles = new Map(before.threads.map((t) => [t.id, t.title]));
  for (const thread of after.threads) {
    const old = titles.get(thread.id);
    if (old !== undefined && old !== thread.title && !out.has(thread.id)) out.set(thread.id, { thread: thread.id, element: `title-${thread.id}`, line: thread.title });
  }
  return [...out.values()];
}

/** Marks kept across a world change: a merged thread's mark moves to the one it joined; a removed thread's goes. */
export function carry(unseen: Unseen[], world: World): Unseen[] {
  const ids = new Set(world.threads.map((t) => t.id));
  const out = new Map<string, Unseen>();
  for (const mark of unseen) {
    const thread = resolve(world, mark.thread);
    if (ids.has(thread)) out.set(thread, { ...mark, thread });
  }
  return [...out.values()];
}

/** Your newest landing among `added` (placed this message), or null: the "latest" mark moves to it. */
export function newestOwn(added: { id: string; speaker: string }[], me: string): string | null {
  return [...added].reverse().find((t) => t.speaker === me || t.speaker === "you")?.id ?? null;
}

// The words a spoken command uses for the thread you're on (core/src/spoken.rs, THIS and focus), after a verb that
// acts on a thread. "This is so exciting" isn't one: the pointing word must follow the verb, or be "this thread",
// "this card", "this one".
const VERB = "(?:expand|unfold|open(?: up)?|show(?: me)?|collapse|fold(?: up)?|close|hide|focus(?: on)?)";
const POINT = "(?:this|that|it|here)(?: one| thread| card)?";
const COMMAND = new RegExp(`^(?:(?:okay|ok|so|well|now|please|can you|could you|let'?s|lets),?\\s+)*${VERB}\\s+${POINT}\\b`, "i");
const NAMED = /\b(?:this|that) (?:thread|card|one)\b/i;

/** Whether the words being said point at a thread as "this" (a command that will act on the thread you're on). */
export function pointsAtThis(words: string): boolean {
  const said = words.trim().replace(/[’]/g, "'");
  return COMMAND.test(said) || NAMED.test(said);
}

/** Which way to look for something off screen, given its top and bottom against the map's visible band. */
export function direction(rect: { top: number; bottom: number }, band: { top: number; bottom: number }): "↑" | "↓" | null {
  if (rect.bottom <= band.top) return "↑";
  if (rect.top >= band.bottom) return "↓";
  return null;
}
