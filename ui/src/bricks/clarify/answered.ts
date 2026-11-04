import type { MapSnapshot } from "../contract";

const wordKey = (term: string) => term.trim().toLocaleLowerCase();
const storageKey = (map: MapSnapshot, thoughtId: string) =>
  JSON.stringify(["clarify-answered", map.visitKey ?? map.mapIdentity ?? "", map.me, thoughtId]);

/** Saved margin answers survive remounts; acknowledgements stay scoped to this map and speaker. */
export function answeredTerms(map: MapSnapshot, thoughtId: string): string[] {
  const saved = map.threads.filter(thread => thread.anchor?.thought_id === thoughtId &&
    map.thoughts.some(thought => thought.thread_id === thread.id && thought.text.trim()))
    .map(thread => thread.anchor!.quote);
  try { return [...new Set([...saved, ...JSON.parse(sessionStorage.getItem(storageKey(map, thoughtId)) ?? "[]") as string[]])]; }
  catch { return saved; }
}

export function rememberAnswer(map: MapSnapshot, thoughtId: string, term: string) {
  const terms = [...new Set([...answeredTerms(map, thoughtId), term])];
  try { sessionStorage.setItem(storageKey(map, thoughtId), JSON.stringify(terms)); } catch { /* Saved notes still supply the answer. */ }
}

export const wasAnswered = (terms: readonly string[], term: string) => terms.some(answer => wordKey(answer) === wordKey(term));
