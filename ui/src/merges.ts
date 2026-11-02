// Following merges, as the core's `World::resolve` does. Pure, so the window's rule modules and the offline checks
// share one copy.
import type { World } from "./core";

/** The thread a merged one became: the end of its merges. At most one hop per merge, so a corrupt snapshot with a
 *  cycle can't freeze the tab. */
export function resolveMerged(world: Pick<World, "merged">, id: string): string {
  for (let hops = Object.keys(world.merged ?? {}).length; hops > 0 && world.merged[id]; hops--) id = world.merged[id];
  return id;
}
