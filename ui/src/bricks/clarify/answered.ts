import type { MapSnapshot } from "../contract";

const wordKey = (term: string) => term.trim().toLocaleLowerCase();
const storageKey = (map: MapSnapshot) =>
  JSON.stringify(["clarify-answered", map.visitKey ?? map.mapIdentity ?? "", map.me]);

/** A word answered once stays answered across this map, so the next thought using it isn't asked again. */
export function answeredTerms(map: MapSnapshot): string[] {
  const saved = map.threads.filter(thread => thread.anchor &&
    map.thoughts.some(thought => thought.thread_id === thread.id && thought.text.trim()))
    .map(thread => thread.anchor!.quote);
  try { return [...new Set([...saved, ...JSON.parse(sessionStorage.getItem(storageKey(map)) ?? "[]") as string[]])]; }
  catch { return saved; }
}

export function rememberAnswer(map: MapSnapshot, term: string) {
  const terms = [...new Set([...answeredTerms(map), term])];
  try { sessionStorage.setItem(storageKey(map), JSON.stringify(terms)); } catch { /* Saved notes still supply the answer. */ }
}

export const wasAnswered = (terms: readonly string[], term: string) => terms.some(answer => wordKey(answer) === wordKey(term));
