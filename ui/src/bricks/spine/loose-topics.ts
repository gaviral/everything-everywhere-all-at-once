import type { End, Layout, Link } from "./layout";

/** Identity, never count or randomness: an arrival cannot reshuffle earlier thoughts. */
export function thoughtOffset(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [0, 12, 4, 18, 8][hash % 5];
}

type Spot = { x: number; y: number };
/** A soft thread passes through the actual markers, including a moved thought's empty place. */
export function looseThread(link: Link, layout: Layout, at: (end: End) => Spot | null): string | null {
  const a = at(link.from), b = at(link.to);
  if (!a || !b) return null;
  const head = layout.byKey.get(link.from.key);
  const between = link.kind === "spine" && head?.kind === "head"
    ? layout.items.filter(item => item.thread === head.thread && !item.pinned && (item.kind === "point" || item.kind === "notch"))
      .sort((left, right) => left.box.y - right.box.y)
      .map(item => at({ key: item.key, dx: item.look?.lineX ?? 20, dy: item.kind === "notch" ? item.box.h / 2 : (item.look?.line ?? 22) / 2 }))
      .filter((spot): spot is Spot => !!spot)
    : [b];
  let path = `M${a.x} ${a.y}`, previous = a;
  for (const next of between) {
    const mid = (previous.y + next.y) / 2;
    path += `C${previous.x} ${mid} ${next.x} ${mid} ${next.x} ${next.y}`;
    previous = next;
  }
  return path;
}
