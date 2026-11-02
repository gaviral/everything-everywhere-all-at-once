// The refiner's renames and merges as the window shows them (core/src/tidy.rs): a rename it was sure of lands with a
// note and Undo; anything else waits on its card as a proposal (Rename or Merge applies it, × keeps things as they
// are); a merge applied can be undone from its note too.
import type { ItemStatus, Thread, World } from "./core";

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
  proposals: string[];
  active: boolean;
  active_by: string[];
}

export type TidyChange =
  | { type: "thread_retitled"; thread_id: string; title: string; was: string }
  | { type: "thread_unmerged"; unmerge: Unmerge }
  | { type: "tidy_proposed"; proposal: Proposal };

type Change = { type: string; [key: string]: unknown };

/** The thread a merged one became, as the core's `World::resolve`. */
function resolve(world: Pick<World, "merged">, id: string): string {
  let at = id;
  for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[at]; hops--) at = world.merged[at];
  return at;
}

/** Applies a tidy change as the core does (`World::apply`); null for any other change. */
export function applyTidy<W extends World>(world: W, change: Change): W | null {
  const c = change as TidyChange;
  switch (c.type) {
    case "thread_retitled": {
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
      const threads = world.threads.map((t) => ({ ...t, parent_id: back(u.branches, t.id, t.parent_id) }));
      threads.splice(Math.min(u.at, threads.length), 0, u.thread);
      const merged = { ...world.merged };
      delete merged[from];
      return {
        ...world,
        threads,
        merged,
        thoughts: world.thoughts.map((t) => ({ ...t, thread_id: back(u.thoughts, t.id, t.thread_id) })),
        suggestions: world.suggestions.map((s) => ({ ...s, thread_id: back(u.suggestions, s.id, s.thread_id)! })),
        actions: world.actions.map((a) => ({ ...a, thread_id: back(u.actions, a.id, a.thread_id)! })),
        proposals: (world.proposals ?? []).map((p) => ({ ...p, thread_id: back(u.proposals, p.id, p.thread_id)! })),
        active: u.active && world.active === into ? from : world.active,
        active_by: Object.fromEntries(Object.entries(world.active_by).map(([who, id]) => [who, u.active_by.includes(who) && id === into ? from : id])),
      };
    }
    default:
      return null;
  }
}

/** Waiting proposals of `kind` on `thread` are done once the map moved past them (`tidy::follow`). */
export function settle(world: World, kind: Proposal["kind"], thread: string): Proposal[] {
  return (world.proposals ?? []).map((p) => (p.kind === kind && p.thread_id === thread && p.status === "new" ? { ...p, status: "done" } : p));
}

/** The note a change gets above the map, and what its Undo takes back; `ai` when the AI did it on its own (✦). */
export type TidyNote = { text: string; ai: boolean; undo?: { kind: Proposal["kind"]; thread_id: string } };

export function tidyNote(world: World, change: Change): TidyNote | null {
  const c = change as TidyChange | { type: "thread_merged"; from: string; into: string };
  const title = (id: string) => world.threads.find((t) => t.id === resolve(world, id))?.title;
  switch (c.type) {
    case "thread_retitled": {
      const id = resolve(world, c.thread_id);
      return title(id) === c.title ? null : { text: `AI renamed “${c.was}” to “${c.title}”`, ai: true, undo: { kind: "rename", thread_id: id } };
    }
    case "thread_merged": {
      const from = world.threads.find((t) => t.id === c.from);
      const into = title(c.into);
      // An empty thread going (words you took back that had started it) isn't a merge to announce.
      const held = world.thoughts.some((t) => t.thread_id === c.from);
      return from && into && held ? { text: `Merged “${from.title}” into “${into}”`, ai: false, undo: { kind: "merge", thread_id: c.from } } : null;
    }
    case "thread_unmerged":
      return { text: `Put back “${c.unmerge.thread.title}”`, ai: false };
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

/** Proposals still waiting, by thread. */
export function waitingByThread(proposals: Proposal[] | undefined): Map<string, Proposal[]> {
  const grouped = new Map<string, Proposal[]>();
  for (const p of proposals ?? []) if (p.status === "new") grouped.set(p.thread_id, [...(grouped.get(p.thread_id) ?? []), p]);
  return grouped;
}
