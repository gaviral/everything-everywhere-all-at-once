import type { Thought, Thread } from "../contract";

const STOP = new Set("the,a,an,and,or,but,for,with,from,that,this,have,has,was,were,you,your,our".split(","));
const words = (text: string) => [...new Set((text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .filter((word) => [...word].length >= 3 && !STOP.has(word)))];
const order = (a: { id: string; touched_ms: number }, b: { id: string; touched_ms: number }) => b.touched_ms - a.touched_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface Connection {
  id: string;
  title: string;
  score: number;
  reason: string;
  excerpt: string;
  original: string | null;
  speaker: string | null;
  at: number;
}

/** One bounded, local selector. Text is evidence of overlap, never a claim that two topics are connected. */
export function relatedThoughts(threads: readonly Thread[], thoughts: readonly Thought[], active: string | null) {
  const seed = threads.find((thread) => thread.id === active);
  const result = { selected: !!seed, candidates: [] as Connection[], topicCap: threads.length > 300, characterCap: false };
  if (!seed) return result;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const ancestors = (id: string) => {
    const seen = new Set<string>();
    let parent = byId.get(id)?.parent_id;
    while (parent && !seen.has(parent)) { seen.add(parent); parent = byId.get(parent)?.parent_id; }
    return seen;
  };
  const excluded = ancestors(seed.id);
  excluded.add(seed.id);
  const scanned = [...threads].sort(order).slice(0, 300);
  const wanted = new Set([seed.id, ...scanned.map((thread) => thread.id)]);
  // Keep just the latest six placed points per topic, without copying all historical text.
  const recent = new Map<string, Thought[]>();
  for (const thought of thoughts) {
    if (!thought.placed || !thought.thread_id || !wanted.has(thought.thread_id)) continue;
    const rows = recent.get(thought.thread_id) ?? [];
    rows.push(thought);
    rows.sort((a, b) => b.at_ms - a.at_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (rows.length > 6) rows.length = 6;
    recent.set(thought.thread_id, rows);
  }
  const fields = (thread: Thread) => {
    let remaining = 4000;
    const take = (text: string) => {
      if (text.length > remaining) result.characterCap = true;
      const part = text.slice(0, remaining);
      remaining -= part.length;
      return part;
    };
    const title = words(take(thread.title));
    const tags = new Set(thread.tags.filter((tag) => tag.kept).map((tag) => words(take(tag.name)).join(" ")).filter(Boolean));
    const points = (recent.get(thread.id) ?? []).map((thought) => ({ thought, point: take(thought.point) }));
    const tokens = new Set([...title, ...[...tags].flatMap(words), ...points.flatMap(({ point }) => words(point))]);
    return { title, tags, points, tokens };
  };
  const source = fields(seed);
  const matches: (Connection & { touched_ms: number })[] = [];
  for (const thread of scanned) {
    if (excluded.has(thread.id) || ancestors(thread.id).has(seed.id)) continue;
    const candidate = fields(thread);
    const tags = [...candidate.tags].filter((tag) => source.tags.has(tag)).sort();
    const titles = candidate.title.filter((token) => source.title.includes(token)).sort();
    const counted = new Set([...titles, ...tags.flatMap(words)]);
    const other = [...candidate.tokens].filter((token) => source.tokens.has(token) && !counted.has(token)).sort();
    const score = 4 * tags.length + 2 * titles.length + other.length;
    if (score < 2) continue;
    const evidence = candidate.points.find(({ point }) => words(point).some((token) => source.tokens.has(token)));
    const reason = [tags.length ? `Shared kept tags: ${tags.join(", ")}` : "", titles.length ? `Shared title words: ${titles.join(", ")}` : "",
      other.length ? `Shared words: ${other.join(", ")}` : ""].filter(Boolean).join(" · ");
    matches.push({ id: thread.id, title: thread.title, score, reason, touched_ms: thread.touched_ms,
      excerpt: evidence?.point ?? thread.title, original: evidence?.thought.text ?? null,
      speaker: evidence?.thought.speaker ?? null, at: evidence?.thought.at_ms ?? thread.touched_ms });
  }
  result.candidates = matches.sort((a, b) => b.score - a.score || order(a, b)).slice(0, 3);
  return result;
}
