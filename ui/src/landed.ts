// Which placed thoughts are a landing: new to the map and never on it before. An Undo of a Delete brings a point back
// as a fresh thought_added; it isn't one, so the map doesn't follow it and it doesn't take the "latest" mark.

/** The thoughts in `placed` not in `before` (the map last time) and never seen placed (`ever`); `ever` then holds
 *  every one in `placed`. */
export function landedNow<T extends { id: string }>(placed: T[], before: Set<string>, ever: Set<string>): T[] {
  const fresh = placed.filter((t) => !before.has(t.id) && !ever.has(t.id));
  for (const t of placed) ever.add(t.id);
  return fresh;
}
