// Move and rename as the window shows them (core/src/moves.rs): a point moved to another thread, said or clicked, lands
// where the person put it, and a merge of the two threads waiting on a card is past. Pure, so scripts/moves-check.mjs
// holds it to the core.
import type { Thread, World } from "./core";

export type MoveChange = { type: "thought_moved"; thought_id: string; thread_id: string; from: string; undo?: boolean };

/** The thread a merged one became, as the core's `World::resolve`. */
function resolve(world: Pick<World, "merged">, id: string): string {
  let at = id;
  for (let hops = Object.keys(world.merged ?? {}).length; hops > 0 && world.merged[at]; hops--) at = world.merged[at];
  return at;
}

/** Applies a move as the core does (`World::moved`, `tidy::follow`): only to a thread on the map; a person's move (not
 *  an undo) settles a merge card between the two threads, since it says they're two topics. */
export function applyMove<W extends World>(world: W, c: MoveChange): W {
  const to = resolve(world, c.thread_id);
  if (!world.threads.some((t) => t.id === to) || !world.thoughts.some((t) => t.id === c.thought_id)) return world;
  const thoughts = world.thoughts.map((t) => (t.id === c.thought_id ? { ...t, thread_id: to } : t));
  if (c.undo) return { ...world, thoughts };
  const from = resolve(world, c.from);
  const between = (a: string, b: string) => (a === from && b === to) || (a === to && b === from);
  const proposals = (world.proposals ?? []).map((p) =>
    p.kind === "merge" && p.status === "new" && p.into && between(resolve(world, p.thread_id), resolve(world, p.into)) ? { ...p, status: "done" as const } : p);
  return { ...world, thoughts, proposals };
}

/** Where a point can go: every other thread, the one touched last first (where talk was just now), narrowed by what
 *  was typed: each typed word starts a word of the title, as Things' Move list narrows. */
export function moveTargets(threads: Thread[], current: string | null, query: string): Thread[] {
  const typed = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const fits = (title: string) => {
    const words = title.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return typed.every((w) => words.some((x) => x.startsWith(w)));
  };
  return threads.filter((t) => t.id !== current && fits(t.title)).sort((a, b) => b.touched_ms - a.touched_ms);
}

/** A title as typed: trimmed; empty or unchanged means nothing to send (Esc and an unchanged Enter both just close). */
export function typedTitle(typed: string, was: string): string | null {
  const title = typed.trim().replace(/\s+/g, " ");
  return title && title !== was ? title : null;
}
