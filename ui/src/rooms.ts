import type { CSSProperties } from "react";
import type { Thread } from "./core";

// Each room's color, in the order rooms started, as the core paints its pictures (core/src/pictures.rs, FAMILIES):
// none near the blue, amber or purple the app keeps for where you are, what needs you and what the AI added.
const FAMILIES = ["green", "pink", "teal", "red", "lime"];

// Every thread's room color: rooms take turns in the order their first thread started; a branch has its room's.
export function roomColors(threads: Thread[]): Map<string, string> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const roots = threads.filter((thread) => !thread.parent_id);
  const colors = new Map<string, string>();
  for (const thread of threads) {
    let root = thread;
    // A parent chain can't be longer than the map; the bound keeps a broken one from looping.
    for (let step = 0; step < threads.length && root.parent_id && byId.has(root.parent_id); step++) root = byId.get(root.parent_id)!;
    colors.set(thread.id, FAMILIES[Math.max(0, roots.indexOf(root)) % FAMILIES.length]);
  }
  return colors;
}

// Hands a room's color to everything inside a card or a Palace room: titles, headings, letter tiles.
export function roomStyle(color: string | undefined): CSSProperties | undefined {
  return color ? ({ "--room": `var(--room-${color})`, "--room-soft": `var(--room-${color}-soft)` } as CSSProperties) : undefined;
}
