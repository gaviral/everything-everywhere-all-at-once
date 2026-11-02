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
  items(after.proposals ?? [], before.proposals ?? [], (p) => (p.kind === "rename" ? `Rename to “${p.title}”?` : "Same topic?"));
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

// "This" as the core reads a spoken command (core/src/spoken.rs `unfold`, main.rs `lead_in` and `FOCUS_ON`, catalog.rs
// `correction`): the words that lead in, then "expand", "unfold" or "collapse" with only a pointing word after it, any
// open or fold verb with everything under a pointing word ("open everything under it"), or "(let's) focus on this";
// also after a correction's lead ("No, I meant collapse this"). The whole turn must be the command: "collapse this
// weekend" names a thread titled "This weekend", and "open this", "hide it" or "this is so exciting" aren't commands
// the core acts on, so none shows "this". "Add this to Reminders" shows nothing either: it adds a waiting action, from
// the card "this" means only when that card has one, and its notice names what it adds.
const LEADS = ["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "eh", "hmm", "hm", "hmmm", "mm", "mmm", "oh", "so", "well",
  "and", "but", "anyway", "anyways", "wait", "actually", "basically", "hold on", "let me think", "let me see", "let s see",
  "yeah", "yep", "yup", "okay", "ok", "alright", "all right", "right", "sure", "mhm", "mm hmm", "uh huh", "cool", "got it",
  "now", "hey", "please", "can you", "could you", "would you", "will you"];
const TAILS = ["please", "for me", "now"];
// spoken.rs `unfold` word for word: its own leads, its verbs (longest first), its pointing words, its "everything"
// words in its order (the first that fits counts) and the words that link them.
const UNFOLD_LEADS = ["can we ", "could we ", "let s ", "lets ", "let us "];
const VERBS = ["expand", "unfold", "open up", "show me", "open", "show", "collapse", "fold up", "fold", "close", "hide"];
const STRONG = ["expand", "unfold", "collapse"];
const POINTING = ["this", "this one", "this thread", "this card", "it", "that", "that one", "that thread", "here", "it all"];
const EVERYTHING = ["everything", "all of the sub cards", "all the sub cards", "all the subcards", "all sub cards", "all the cards",
  "all the branches", "all the threads", "all threads", "all cards", "all branches", "every card", "every thread", "the sub cards",
  "the subcards", "the branches", "all of it", "all of", "all"];
const UNDER = ["inside of", "inside", "under", "within", "in", "of", "on"];
// main.rs `FOCUS_ON`, after "focus on" or "let's focus on", with the core's one tail ("mode").
export const FOCUS_ON = ["this", "this one", "this thread", "this card", "that", "that one", "that thread", "that card"];
// catalog.rs `STRONG`, `AFTER_NO` and `NO`: the leads of "No, I meant …". "I mean" and "I said" count only after a no.
export const CORRECTION = ["i meant to say", "i meant", "what i meant was", "i was asking you to", "i was asking for", "i asked you to",
  "i asked for", "i wanted you to", "i wanted", "that s not what i meant", "that s not what i asked for", "that s not what i asked",
  "not what i meant", "i was trying to"];
export const AFTER_NO = ["i mean", "i said"];
export const NO = ["no", "nope", "nah", "sorry", "oops", "wait", "actually"];

/** Whether main.rs `focuses_this` reads the turn (its leads already off) as focusing "this": only its own tail, "mode",
 *  and a "please" after it, not the wider TAILS ("focus on that card now" is a thought there). */
function focusesThis(led: string): boolean {
  const asked = led.replace(/ please$/, "").replace(/ mode$/, "").match(/^(?:let s )?focus on (.+)$/);
  return !!asked && FOCUS_ON.includes(asked[1]);
}

/** What a correction asks for (catalog.rs `correction`: its lead skipped), or null when it isn't one. The bare
 *  "No, …" form needs a pause and a request just before, which the live words can't tell, so it shows nothing. */
function corrected(said: string): string | null {
  const w = said.split(" ");
  let at = 0;
  while (at < w.length && NO.includes(w[at])) at++;
  const no = w.slice(0, at).some((x) => x === "no" || x === "nope" || x === "nah");
  const leads = [...CORRECTION, ...(no ? AFTER_NO : [])].sort((a, b) => b.length - a.length);
  for (const lead of leads) {
    const l = lead.split(" ");
    if (!l.every((x, i) => w[at + i] === x)) continue;
    const end = at + l.length;
    // "I meant to call Mom" is talk.
    if (lead === "i meant" && w[end] === "to") return null;
    return w.slice(end).join(" ") || null;
  }
  return null;
}

/** Whether spoken.rs `unfold` reads the whole turn as opening or folding "this" (`Target::This`): a strong verb and a
 *  pointing word ("collapse that one"), or any verb with everything under one ("open everything under it"). A bare
 *  verb acts on "this" too, but nothing in it points, so it shows nothing. */
function unfoldsThis(said: string): boolean {
  let l = said;
  for (const lead of UNFOLD_LEADS) if (l.startsWith(lead)) l = l.slice(lead.length);
  const verb = VERBS.find((v) => l === v || l.startsWith(`${v} `));
  if (!verb) return false;
  const rest = l.slice(verb.length).trim();
  if (POINTING.includes(rest)) return STRONG.includes(verb);
  // "Open all of it" is every thread: "all of it" fits before "all of".
  const all = EVERYTHING.find((a) => rest === a || rest.startsWith(`${a} `));
  if (!all) return false;
  const after = rest.slice(all.length).trim();
  const link = UNDER.find((p) => after.startsWith(`${p} `));
  return POINTING.includes(link ? after.slice(link.length + 1) : all === "all of" ? after : "");
}

/** "card" when the words being said are a whole command the core acts on "this" with (opening, folding or focusing
 *  the card you selected or point at, else your active thread: this-card.ts `resolveThis`); "correction" when they
 *  redo the last turn as one ("No, I meant collapse this"), which acts only while the core says there's a turn to
 *  correct, and from where undoing it takes you (`thisBase`); else null. */
export function thisKind(words: string, correcting = true): "card" | "correction" | null {
  const strip = (said: string, tails: string[]) => {
    for (let again = true; again;) {
      again = false;
      for (const lead of LEADS) if (said.startsWith(`${lead} `)) { said = said.slice(lead.length + 1); again = true; }
      for (const tail of tails) if (said.endsWith(` ${tail}`)) { said = said.slice(0, -tail.length - 1); again = true; }
    }
    return said;
  };
  const said = words.toLowerCase().replace(/['’]/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
  const led = strip(said, []);
  if (focusesThis(led) || unfoldsThis(strip(said, TAILS))) return "card";
  // A correction redoes what it names, read as its own turn; never a correction of a correction (catalog.rs).
  const rest = correcting ? corrected(led) : null;
  return rest && thisKind(rest, false) ? "correction" : null;
}

/** What the core will pick "this" from, as of `now`: for a command, your active thread when nothing is selected or
 *  pointed at; for a correction, where undoing your last turn takes you (catalog.rs `redo` undoes it first: after
 *  "Next one" took you to Bills, "No, I meant collapse this" folds the card you were on), and none at all, so no
 *  mark, once the core has no turn to correct (catalog.rs `correct`: none within its window, or a restarted core).
 *  `correctable` is the core's word on that (`Correctable`, with when it runs out here). */
export function thisBase(kind: "card" | "correction" | null, correctable: { until: number; back_to: string | null } | null,
  active: string | null, now: number): { active: string | null } | null {
  if (kind === "card") return { active };
  if (kind === "correction" && correctable && now <= correctable.until) return { active: correctable.back_to ?? active };
  return null;
}

/** Whether the words being said are a command the core will act on "this" with. */
export function pointsAtThis(words: string): boolean {
  return thisKind(words) !== null;
}

/** Which way to look for something off screen, given its top and bottom against the map's visible band. */
export function direction(rect: { top: number; bottom: number }, band: { top: number; bottom: number }): "↑" | "↓" | null {
  if (rect.bottom <= band.top) return "↑";
  if (rect.top >= band.bottom) return "↓";
  return null;
}
