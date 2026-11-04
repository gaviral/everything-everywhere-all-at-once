// Which placed thoughts are a landing: new to the map and never on it before. An Undo of a Delete brings a point back
// as a fresh thought_added; it isn't one, so the map doesn't follow it and it doesn't take the "latest" mark.

/** The thoughts in `placed` not in `before` (the map last time) and never seen placed (`ever`); `ever` then holds
 *  every one in `placed`. */
export function landedNow<T extends { id: string }>(placed: T[], before: Set<string>, ever: Set<string>): T[] {
  const fresh = placed.filter((t) => !before.has(t.id) && !ever.has(t.id));
  for (const t of placed) ever.add(t.id);
  return fresh;
}

/** A lazy view can mount after its first landing. Keep only the newest for five seconds,
 *  once per named consumer; a reconnect or a newer landing invalidates queued replay. */
export function landingReplay<T extends { thoughtId: string }>() {
  let last: { value: T; at: number } | null = null;
  const consumed = new Map<string, string>();
  const claim = (value: T, consumer?: string) => {
    if (!consumer) return true;
    if (consumed.get(consumer) === value.thoughtId) return false;
    consumed.set(consumer, value.thoughtId);
    return true;
  };
  return {
    remember(value: T) { last = { value, at: Date.now() }; },
    claim,
    replay(consumer: string, active: () => boolean, deliver: (value: T) => void) {
      const cached = last;
      if (!cached) return;
      queueMicrotask(() => {
        if (last === cached && Date.now() - cached.at <= 5000 && active() && claim(cached.value, consumer)) {
          deliver(cached.value);
        }
      });
    },
    clear() { last = null; consumed.clear(); },
  };
}
