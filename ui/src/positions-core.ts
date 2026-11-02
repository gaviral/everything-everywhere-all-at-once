// Places on the canvas as the window holds them (core/src/positions.rs): a thread's card or a thought's point put
// somewhere by a person's window or an AI participant, as absolute canvas coordinates of its top-left. One not in
// `positions` is laid out automatically. Pure, so scripts/world-mirror-check.mjs holds it to the core.
import type { World } from "./core";

/** Where it was put, by whom (a speaker: a person, or an AI participant's name) and when. */
export interface Position {
  x: number;
  y: number;
  by: string;
  at_ms: number;
}

/** Both numbers: put there. Both null: back to the automatic layout. */
export type PositionChange = { type: "positioned"; id: string; x: number | null; y: number | null; by: string; at_ms: number };

/** As the core's `World::apply`: a place only for a thread on the map or a thought; two nulls take it away; anything
 *  else (one number alone) changes nothing. */
export function applyPosition<W extends World>(world: W, c: PositionChange): W {
  if (typeof c.x === "number" && typeof c.y === "number") {
    if (!world.threads.some((t) => t.id === c.id) && !world.thoughts.some((t) => t.id === c.id)) return world;
    return { ...world, positions: { ...world.positions, [c.id]: { x: c.x, y: c.y, by: c.by, at_ms: c.at_ms } } };
  }
  if (c.x != null || c.y != null || !world.positions?.[c.id]) return world;
  const positions = { ...world.positions };
  delete positions[c.id];
  return { ...world, positions };
}

/** As the core: a thread or thought that leaves the map (deleted, set aside, merged away, taken off) takes its place
 *  with it; Undo brings it back in the layout. */
export function keepPlaced<W extends World>(world: W): W {
  const positions = world.positions;
  if (!positions) return world;
  const ids = Object.keys(positions);
  if (ids.length === 0) return world;
  const here = new Set([...world.threads.map((t) => t.id), ...world.thoughts.map((t) => t.id)]);
  if (ids.every((id) => here.has(id))) return world;
  return { ...world, positions: Object.fromEntries(Object.entries(positions).filter(([id]) => here.has(id))) };
}
