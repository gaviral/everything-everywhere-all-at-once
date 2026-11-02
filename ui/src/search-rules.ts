// What search finds and which found cards it holds open, kept pure so scripts/search-check.mjs can hold them.

/** The threads a query finds, best first. A thread is found when every word of the query is somewhere in it (its
 *  title, a tag, a thought's words or its point), in any order: people search the way they'd say it ("dentist
 *  thursday", "launch date"), and the whole query as one phrase found nothing for 4 of 4 synthetic users (persona runs,
 *  2026-11-01). A word still can't run across two fields ("lis" + "bon" isn't "lisbon"). Everything the old rule found
 *  (the whole query inside one field) is still found and comes first. Ranked by, in turn:
 *  1. the query exactly as typed inside one field (what the old rule found; an accent typed is meant),
 *  2. every word inside one field (one thought says it all, vs words scattered over a long thread),
 *  3. more words found at a word's start ("art" → "Art class" before "party"),
 *  4. more words starting a word of the thread's title (the first field: the thread named for it, vs one that
 *     mentions it; "art" names "Art class", not "Kids party"),
 *  then map order. Tiers, not weights: each is a plain reason, none trades off against another. Empty query → none. */
export function searchMatches(index: { id: string; fields: string[] }[], search: string): Set<string> {
  const words = searchWords(search);
  if (!words.length) return new Set();
  const found: { id: string; rank: number[] }[] = [];
  for (const { id, fields } of index) {
    const { folded, joined } = prepare(fields);
    if (!words.every((word) => joined.includes(word))) continue;
    found.push({ id, rank: [
      fields.some((text) => text.includes(search)) ? 1 : 0,
      words.length === 1 || folded.some((text) => words.every((word) => text.includes(word))) ? 1 : 0,
      words.filter((word) => startsWord(joined, word)).length,
      words.filter((word) => startsWord(folded[0] ?? "", word)).length,
    ] });
  }
  found.sort((a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i]; return 0; });
  return new Set(found.map(({ id }) => id));
}

/** Text as search compares it: lower case, accents off, so "cafe" finds "Café". */
export function searchText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

/** Small words that carry a question's grammar, not its topic: "when is the dentist" looks for "dentist". */
const SMALL = new Set(("a an the and or of to in on at for from with about by is are was were be been am do does did " +
  "i me my we our you your it its this that what when where which who how").split(" "));

/** The words a query looks for: folded, edge punctuation off ("thursday?" → "thursday", "$80" kept), each once, small
 *  words dropped unless the query is only small words ("to do" still looks for both). Only punctuation → itself. */
export function searchWords(search: string): string[] {
  const all = [...new Set(searchText(search).split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}$€£#@]+|[^\p{L}\p{N}%]+$/gu, "")).filter(Boolean))];
  const topic = all.filter((word) => !SMALL.has(word));
  return topic.length ? topic : all.length ? all : search.trim() ? [searchText(search.trim())] : [];
}

/** Each thread's text folded once and joined by line breaks (no query word holds one, so none runs across two
 *  fields). Keyed on the fields list, which the map reuses while a thread is unchanged → a letter costs only the scan. */
const prepared = new WeakMap<string[], { folded: string[]; joined: string }>();
function prepare(fields: string[]) {
  let ready = prepared.get(fields);
  if (!ready) {
    const folded = fields.map(searchText);
    prepared.set(fields, ready = { folded, joined: folded.join("\n") });
  }
  return ready;
}

function startsWord(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) if (at === 0 || !inWord(text.charCodeAt(at - 1))) return true;
  return false;
}
const LETTER = /[\p{L}\p{N}]/u;
/** A letter or digit (ASCII by code, the rest by Unicode class): checked per occurrence, so the common case skips the regex. */
const inWord = (code: number) => code < 128 ? (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || (code >= 65 && code <= 90) : LETTER.test(String.fromCharCode(code));

/** Found threads show best first only when there are at most this many; more keep map order, as before. Ranking is
 *  for picking one out of a list you read: ≈ 2 screens of folded titles at 1440 × 900 (68 px a title, two columns,
 *  ≈ 20 a screen); past that you add a word rather than read on (OPEN_LIMIT's reasoning, for titles). It also keeps a
 *  letter that finds most of a big map cheap: reordering all 1,000 found cards after "l" held the page 140–151 ms
 *  (moved cards change column and remount), where map order changes nothing (search.mjs, 2026-11-01). */
export const RANK_LIMIT = 40;

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
