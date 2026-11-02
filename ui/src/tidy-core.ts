// The refiner's renames and merges as the window shows them (core/src/tidy.rs): a rename it was sure of lands with a
// note and Undo; anything else waits on its card as a proposal (Rename or Merge applies it, × keeps things as they
// are); a merge applied can be undone from its note too.
import type { ItemState, ItemStatus, Thought, Thread, World } from "./core";
import { resolveMerged as resolve } from "./merges";

export interface Proposal {
  id: string;
  kind: "rename" | "merge";
  /** The thread to rename, or the one that would merge away. */
  thread_id: string;
  title?: string;
  into?: string;
  status: ItemStatus;
}

/** What a merge moved, to put it back: mirrors `tidy::Unmerge`. */
export interface Unmerge {
  thread: Thread;
  into: string;
  at: number;
  thoughts: string[];
  branches: string[];
  suggestions: string[];
  actions: string[];
  /** Proposals that were waiting on it: the merge left them behind, and an undo asks them again. */
  proposals: string[];
  active: boolean;
  active_by: string[];
  /** Its card's point once back, read when the undo was made; absent in a journal from before it. */
  last_point?: string | null;
}

export type TidyChange =
  | { type: "thread_retitled"; thread_id: string; title: string; was: string }
  | { type: "title_chosen"; thread_id: string; title: string }
  | { type: "thread_unmerged"; unmerge: Unmerge }
  | { type: "tidy_proposed"; proposal: Proposal };

type Change = { type: string; [key: string]: unknown };

/** Applies a tidy change as the core does (`World::apply`); null for any other change. */
export function applyTidy<W extends World>(world: W, change: Change): W | null {
  const c = change as TidyChange;
  switch (c.type) {
    case "thread_retitled":
    case "title_chosen": {
      const id = resolve(world, c.thread_id);
      return { ...world, threads: world.threads.map((t) => (t.id === id ? { ...t, title: c.title } : t)), proposals: settle(world, "rename", id) };
    }
    case "tidy_proposed":
      return (world.proposals ?? []).some((p) => p.id === c.proposal.id) ? world : { ...world, proposals: [...(world.proposals ?? []), c.proposal] };
    case "thread_unmerged": {
      const u = c.unmerge;
      const from = u.thread.id;
      if (world.threads.some((t) => t.id === from) || !world.merged[from]) return world;
      const into = resolve(world, u.into);
      const back = (ids: string[], id: string, on: string | null) => (on === into && ids.includes(id) ? from : on);
      const thoughts = world.thoughts.map((t) => ({ ...t, thread_id: back(u.thoughts, t.id, t.thread_id) }));
      // As the core: its card shows its newest point now there (by Thought::said_at; a tie goes to the later one), so
      // one deleted since the merge isn't on it.
      // Carried in the change when the undo was made (the core's `tidy::unmerging`), so no clock is read here.
      const now = Date.now();
      const saidAt = (t: Thought) => (t.at_ms > now ? 0 : t.at_ms);
      const newest = u.last_point ?? thoughts.filter((t) => t.placed && t.thread_id === from).reduce<Thought | undefined>((n, t) => (!n || saidAt(t) >= saidAt(n) ? t : n), undefined)?.point;
      const merged = { ...world.merged };
      delete merged[from];
      const threads = world.threads.map((t) => ({ ...t, parent_id: back(u.branches, t.id, t.parent_id) }));
      // As the core: a parent merged away since means the thread it went into; one off the map, none.
      const parent = u.thread.parent_id ? resolve({ ...world, merged }, u.thread.parent_id) : null;
      const parent_id = parent && parent !== from && threads.some((t) => t.id === parent) ? parent : null;
      threads.splice(Math.min(u.at, threads.length), 0, { ...u.thread, parent_id, ...(newest != null ? { last_point: newest } : {}) });
      return {
        ...world,
        threads,
        merged,
        thoughts,
        suggestions: world.suggestions.map((s) => ({ ...s, thread_id: back(u.suggestions, s.id, s.thread_id)! })),
        actions: world.actions.map((a) => ({ ...a, thread_id: back(u.actions, a.id, a.thread_id)! })),
        proposals: (world.proposals ?? []).map((p) => (u.proposals.includes(p.id) && p.thread_id === from && p.status === "done" ? { ...p, status: "new" } : p)),
        active: u.active && world.active === into ? from : world.active,
        active_by: Object.fromEntries(Object.entries(world.active_by).map(([who, id]) => [who, u.active_by.includes(who) && id === into ? from : id])),
      };
    }
    default:
      return null;
  }
}

/** Waiting proposals of `kind` (null: any) on `thread` are done once the map moved past them (`tidy::follow`, and
 * `tidy::record` for a merge: a proposal about a thread that went never moves to the one it went into). */
export function settle(world: World, kind: Proposal["kind"] | null, thread: string): Proposal[] {
  return (world.proposals ?? []).map((p) => ((kind === null || p.kind === kind) && p.thread_id === thread && p.status === "new" ? { ...p, status: "done" } : p));
}

/** What one Undo takes back. */
export type TidyUndo = { kind: Proposal["kind"]; thread_id: string };

/** The note a change gets above the map, and what its Undo takes back; `ai` when the AI did it on its own (✦),
 * `renamed` the AI's renames it tells of ([was, title]), and `refined` the ideas and tasks it withdrew or corrected
 * (`restore`: their ids, which Undo puts back). */
export type TidyNote = { text: string; ai: boolean; undo?: TidyUndo[]; renamed?: [string, string][]; restore?: string[]; refined?: Refined[] };

/** An idea or task the refiner brought in line with something said later: what it was, what it became, and why. */
export type Refined = { was: ItemState; now: ItemState; why: string };

/** A refiner pass's renames and corrections arrive one by one: while a note of them is up, the next joins it, so
 * every one keeps its Undo (one Undo takes them all back). Any other note replaces what was up. */
export function joinNotes(shown: TidyNote | null, note: TidyNote): TidyNote {
  const ofPass = (n: TidyNote | null) => !!(n?.renamed || n?.refined);
  if (!ofPass(shown) || !ofPass(note)) return note;
  const renamed = [...(shown!.renamed ?? []), ...(note.renamed ?? [])];
  const refined = [...(shown!.refined ?? []), ...(note.refined ?? [])];
  const undo = [...(shown!.undo ?? []), ...(note.undo ?? [])].filter((u, i, all) => all.findIndex((x) => x.thread_id === u.thread_id) === i);
  const restore = [...new Set([...(shown!.restore ?? []), ...(note.restore ?? [])])];
  if (!refined.length) return { text: renamedText(renamed), ai: true, undo, renamed };
  const text = [renamed.length ? renamedText(renamed) : "", refinedText(refined)].filter(Boolean).join(" · ");
  return { text, ai: true, ...(undo.length ? { undo } : {}), ...(renamed.length ? { renamed } : {}), restore, refined };
}

/** A task's day as its row shows it ("Wed, Nov 11"). */
function shownDay(when: string): string {
  const [y, m, d] = when.split("-").map(Number);
  return when ? new Date(y, m - 1, d, 9).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "no day";
}

/** What happened to one item, in a few words. */
function refinedWords({ was, now }: Refined): string {
  if (now.status === "dismissed") return `took back “${was.text}”`;
  if (now.text === was.text) return `moved “${was.text}” to ${shownDay(now.when)}`;
  return `changed “${was.text}” to “${now.text}”${now.when !== was.when ? `, ${shownDay(now.when)}` : ""}`;
}

/** One is said with its reason (the words that changed it); two without; more by their old words only, so the note
 * stays on one line of a phone. */
function refinedText(refined: Refined[]): string {
  if (refined.length === 1) return `AI ${refinedWords(refined[0])}${refined[0].why ? `: ${refined[0].why}` : ""}`;
  if (refined.length === 2) return `AI ${refinedWords(refined[0])} and ${refinedWords(refined[1])}`;
  const old = refined.map((r) => `“${r.was.text}”`);
  return `AI updated ${refined.length} ideas and tasks to what you said: ${old.slice(0, -1).join(", ")} and ${old[old.length - 1]}`;
}

/** Two renames are said in full; more would run past a phone's width, so only their new titles are. */
function renamedText(renamed: [string, string][]): string {
  const pair = ([was, title]: [string, string]) => `“${was}” to “${title}”`;
  if (renamed.length <= 2) return `AI renamed ${renamed.map(pair).join(" and ")}`;
  const titles = renamed.map(([, title]) => `“${title}”`);
  return `AI renamed ${renamed.length} threads: ${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

export function tidyNote(world: World, change: Change): TidyNote | null {
  const c = change as TidyChange | { type: "thread_merged"; from: string; into: string } | { type: "item_refined"; id: string; now: ItemState; was: ItemState; why: string };
  const title = (id: string) => world.threads.find((t) => t.id === resolve(world, id))?.title;
  switch (c.type) {
    case "thread_retitled": {
      const id = resolve(world, c.thread_id);
      const renamed: [string, string][] = [[c.was, c.title]];
      return title(id) === c.title ? null : { text: renamedText(renamed), ai: true, undo: [{ kind: "rename", thread_id: id }], renamed };
    }
    case "thread_merged": {
      const from = world.threads.find((t) => t.id === c.from);
      const into = title(c.into);
      // An empty thread going (words you took back that had started it) isn't a merge to announce.
      const held = world.thoughts.some((t) => t.thread_id === c.from);
      return from && into && held ? { text: `Merged “${from.title}” into “${into}”`, ai: false, undo: [{ kind: "merge", thread_id: c.from }] } : null;
    }
    case "thread_unmerged":
      return { text: `Put back “${c.unmerge.thread.title}”`, ai: false };
    case "item_refined": {
      // Said only for an item on the map (a replayed or repeated one says nothing).
      const idea = world.suggestions.find((s) => s.id === c.id);
      const task = world.actions.find((a) => a.id === c.id);
      const shown = idea ? { status: idea.status, text: idea.text, when: "" } : task ? { status: task.status, text: task.title, when: task.when } : null;
      if (!shown || shown.status !== c.was.status || shown.text !== c.was.text || shown.when !== c.was.when) return null;
      const refined: Refined[] = [{ was: c.was, now: c.now, why: c.why.trim() }];
      return { text: refinedText(refined), ai: true, restore: [c.id], refined };
    }
    default:
      return null;
  }
}

/** What a proposal says on its card, its button, and what × means. */
export function proposalWords(p: Proposal, world: World): { text: string; apply: string; keep: string } | null {
  if (p.kind === "rename") return p.title ? { text: `Rename to “${p.title}”?`, apply: "Rename", keep: "Keep the title" } : null;
  const into = p.into && world.threads.find((t) => t.id === resolve(world, p.into!));
  return into ? { text: `Same topic as “${into.title}”?`, apply: "Merge", keep: "Keep them apart" } : null;
}

/** The proposal waiting on each thread: a card asks one thing at a time (a rename and a merge can both wait), so the
 * next shows once the first is answered, and a folded card's count agrees with what opening it shows. */
export function waitingByThread(proposals: Proposal[] | undefined): Map<string, Proposal[]> {
  const first = new Map<string, Proposal[]>();
  for (const p of proposals ?? []) if (p.status === "new" && !first.has(p.thread_id)) first.set(p.thread_id, [p]);
  return first;
}
