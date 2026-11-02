// What search finds and which found cards it holds open, kept pure so scripts/search-check.mjs can hold them.

/** The threads a query finds: any one field (a title, a tag, a thought's words or its point) holds the whole query.
 *  Fields stay separate so a query can't match across two pieces of text. Empty query → none. */
export function searchMatches(index: { id: string; fields: string[] }[], search: string): Set<string> {
  return new Set(search ? index.filter(({ fields }) => fields.some((text) => text.includes(search))).map(({ id }) => id) : []);
}

/** At most this many found cards open themselves. Opening a card is for reading why it matched, in place; a query
 *  that finds more is still being typed (one letter finds every thread), and you narrow it rather than read past
 *  about two screens of open cards (1440 × 900, two columns of ≈ 280 px open cards → ≈ 6 a screen, 12 in two).
 *  It also keeps the keystroke in one frame: at 1,000 threads, opening all of "l"'s 1,000 cards froze the page
 *  0.9–1.0 s, and opening 11 costs one frame (search.mjs, 2026-11-01). Found threads past the limit still show,
 *  with their titles, as they were (open or folded), and fold or open by hand. */
export const OPEN_LIMIT = 12;

/** The found threads search holds open (their Hide does nothing while it does): all of them up to OPEN_LIMIT, else
 *  none. All or none, never the first few: which few would be arbitrary, and a card opening only because of where
 *  it sits in the map would read as a second, hidden rule. */
export function heldOpen(matches: Set<string>, limit = OPEN_LIMIT): Set<string> {
  return matches.size > 0 && matches.size <= limit ? matches : NONE;
}
const NONE: Set<string> = new Set();

/** The query the map shows. Typed letters reach the map deferred (the box never waits on the cards), but a cleared
 *  search comes back at once: Back to active, Clear, Esc and every jump clear it and then scroll to a card on the
 *  next frame, which must already be on the page. */
export function mapQuery(typed: string, deferred: string): string {
  return typed.trim() ? deferred : typed;
}

/** The map's threads by parent, reusing last time's lists (and the whole map) where nothing changed, so a letter that
 *  leaves the shown cards as they were re-renders none of them. At 1,000 threads "l" finds every thread: the cards
 *  stay as they were, yet re-rendering all 1,000 held the page 56–72 ms after the box had painted. */
export function steady<K, T>(previous: Map<K, T[]> | undefined, next: Map<K, T[]>): Map<K, T[]> {
  let same = !!previous && previous.size === next.size;
  for (const [key, list] of next) {
    const was = previous?.get(key);
    if (was && was.length === list.length && was.every((item, i) => item === list[i])) next.set(key, was);
    else same = false;
  }
  return same && previous ? previous : next;
}

/** Whether a card can skip re-rendering: every prop the same, and the same branch lists all the way down its subtree
 *  (a card renders its branches, so a change anywhere under it must reach them). */
export function sameCard<P extends { thread: { id: string }; childrenByParent: Map<string | null, { id: string }[]> }>(a: P, b: P): boolean {
  for (const key of Object.keys(b) as (keyof P)[]) if (key !== "childrenByParent" && !Object.is(a[key], b[key])) return false;
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  const stack = [b.thread.id];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const list = b.childrenByParent.get(id);
    if (a.childrenByParent.get(id) !== list) return false;
    for (const child of list ?? []) stack.push(child.id);
  }
  return true;
}
