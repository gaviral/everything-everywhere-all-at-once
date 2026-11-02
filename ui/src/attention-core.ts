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

/** Marks kept across a world change: a merged thread's mark moves to the one it joined; a removed thread's goes. A
 *  new title's mark points at the joined thread's title, as the old title is gone with its card. */
export function carry(unseen: Unseen[], world: World): Unseen[] {
  const threads = new Map(world.threads.map((t) => [t.id, t]));
  const out = new Map<string, Unseen>();
  for (const mark of unseen) {
    const thread = threads.get(resolve(world, mark.thread));
    if (!thread) continue;
    const retitled = thread.id !== mark.thread && mark.element === `title-${mark.thread}`;
    out.set(thread.id, retitled ? { thread: thread.id, element: `title-${thread.id}`, line: thread.title } : { ...mark, thread: thread.id });
  }
  return [...out.values()];
}

/** Your newest landing among `added` (placed this message), or null: the "latest" mark moves to it. */
export function newestOwn(added: { id: string; speaker: string }[], me: string): string | null {
  return [...added].reverse().find((t) => t.speaker === me || t.speaker === "you")?.id ?? null;
}

/** Your newest thought among `thoughts` by when you said it, for a page that didn't see them land (a fresh page, a
 *  reconnect): a time ahead of `now` (a sample's) counts least. */
export function newestSaid(thoughts: { id: string; speaker: string; at_ms: number }[], me: string, now: number): string | null {
  let best: { id: string; at: number } | null = null;
  for (const t of thoughts) {
    if (t.speaker !== me && t.speaker !== "you") continue;
    const at = t.at_ms > now ? 0 : t.at_ms;
    if (!best || at >= best.at) best = { id: t.id, at };
  }
  return best?.id ?? null;
}

// "This" as the core reads a spoken command (core/src/spoken.rs `unfold`, main.rs `lead_in` and the focus view): the
// words that lead in, then "expand", "unfold" or "collapse" with only a pointing word after it, or "focus on this".
// The whole turn must be the command: "collapse this weekend" names a thread titled "This weekend", and "open this",
// "hide it" or "this is so exciting" aren't commands the core acts on, so none shows "this".
const LEADS = ["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "eh", "hmm", "hm", "hmmm", "mm", "mmm", "oh", "so", "well",
  "and", "but", "anyway", "anyways", "wait", "actually", "basically", "hold on", "let me think", "let me see", "let s see",
  "yeah", "yep", "yup", "okay", "ok", "alright", "all right", "right", "sure", "mhm", "mm hmm", "uh huh", "cool", "got it",
  "now", "hey", "please", "can you", "could you", "would you", "will you"];
const TAILS = ["please", "for me", "now"];
const THIS = "(?:this|this one|this thread|this card|it|that|that one|that thread|here|it all)";
const COMMAND = new RegExp(`^(?:(?:(?:can we|could we|let s|lets|let us) )?(?:expand|unfold|collapse) ${THIS}|focus on this(?: thread| one)?(?: mode)?)$`);

/** Whether the words being said are a command the core will act on "this" with: the thread you're on. */
export function pointsAtThis(words: string): boolean {
  let said = words.toLowerCase().replace(/['’]/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
  for (let again = true; again;) {
    again = false;
    for (const lead of LEADS) if (said.startsWith(`${lead} `)) { said = said.slice(lead.length + 1); again = true; }
    for (const tail of TAILS) if (said.endsWith(` ${tail}`)) { said = said.slice(0, -tail.length - 1); again = true; }
  }
  return COMMAND.test(said);
}

/** Which way to look for something off screen, given its top and bottom against the map's visible band. */
export function direction(rect: { top: number; bottom: number }, band: { top: number; bottom: number }): "↑" | "↓" | null {
  if (rect.bottom <= band.top) return "↑";
  if (rect.top >= band.bottom) return "↓";
  return null;
}
