import type { Thought, ThoughtSource } from "../contract";

// Tunable experiment constants: word overlap is not evidence of semantic equivalence.
export const MIN_TOKENS = 8;
export const LOOKBACK = 100;
export const MIN_JACCARD = 0.90;
export const MIN_LENGTH_RATIO = 0.90;
export const MAX_MARKS = 20;

export type Pair = { earlier: ThoughtSource; current: ThoughtSource; score: number };
export type Visit = { dismissed: Set<string>; marks: Pair[] };
export const newVisit = (): Visit => ({ dismissed: new Set(), marks: [] });
export const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
export const sourceOf = (thought: Thought): ThoughtSource => ({ id: thought.id, text: thought.text, threadId: thought.thread_id!, at: thought.at_ms, speaker: thought.speaker });
export const pairKey = (pair: Pair) => JSON.stringify([pair.earlier, pair.current]);

export function sourceValid(source: ThoughtSource, thoughts: readonly Thought[]): boolean {
  const thought = thoughts.find((thought) => thought.id === source.id);
  return !!thought?.placed && thought.thread_id === source.threadId && thought.text === source.text
    && thought.at_ms === source.at && thought.speaker === source.speaker;
}
export const pairValid = (pair: Pair, thoughts: readonly Thought[]) => sourceValid(pair.earlier, thoughts) && sourceValid(pair.current, thoughts);

export function scoreWords(a: readonly string[], b: readonly string[]): number | null {
  if (Math.min(a.length, b.length) < MIN_TOKENS || Math.min(a.length, b.length) / Math.max(a.length, b.length) < MIN_LENGTH_RATIO) return null;
  if (a.length === b.length && a.every((word, i) => word === b[i])) return 1;
  const left = new Set(a), right = new Set(b);
  const common = [...left].filter((word) => right.has(word)).length;
  const score = common / new Set([...left, ...right]).size;
  return score >= MIN_JACCARD ? score : null;
}

/** Only this speaker's latest 100 earlier placed thoughts in this map; one candidate. */
export function repeatCandidate(thoughts: readonly Thought[], id: string, me: string): Pair | null {
  const current = thoughts.find((thought) => thought.id === id);
  if (!current?.placed || !current.thread_id || current.speaker !== me) return null;
  const index = thoughts.indexOf(current);
  const earlier = thoughts.map((thought, i) => ({ thought, i }))
    .filter(({ thought, i }) => thought.id !== id && thought.placed && thought.thread_id && thought.speaker === me
      && (thought.at_ms < current.at_ms || (thought.at_ms === current.at_ms && i < index)))
    .sort((a, b) => b.thought.at_ms - a.thought.at_ms || b.i - a.i).slice(0, LOOKBACK);
  const currentWords = words(current.text);
  let best: Pair | null = null;
  for (const { thought } of earlier) {
    const score = scoreWords(currentWords, words(thought.text));
    if (score !== null && (!best || score > best.score)) best = { earlier: sourceOf(thought), current: sourceOf(current), score };
  }
  return best;
}

export function markRepeat(visit: Visit, pair: Pair, thoughts: readonly Thought[]): boolean {
  if (!pairValid(pair, thoughts)) return false;
  visit.marks = visit.marks.filter((mark) => pairValid(mark, thoughts) && pairKey(mark) !== pairKey(pair));
  visit.marks.push(pair);
  visit.marks = visit.marks.slice(-MAX_MARKS);
  return true;
}
