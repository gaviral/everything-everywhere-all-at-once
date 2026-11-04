import type { Thread, Thought } from '../contract';

export type Material = { threads: readonly Thread[]; thoughts: readonly Thought[]; example: boolean };
export type View = 'tree' | 'conversation' | 'notes';
export type Reference = { id: string; topic: string | null; words: string; speaker: string };
export type Notebook = { text: string; references: Reference[] };
export type Visit = { view: View; topic: string; source: string | null; all: boolean; notebooks: Record<string, Notebook> };

const visits = new Map<string, Visit>();
export function readVisit(scope: string, material: Material): Visit {
  return visits.get(scope) ?? { view: 'tree', topic: material.threads[0]?.id ?? '', source: null, all: false,
    notebooks: material.example ? { 'example-opening': { text: 'Lead with the garden people can imagine. Keep the first visit simple.', references: [] } } : {} };
}
export function keepVisit(scope: string, value: Visit) {
  visits.delete(scope);
  visits.set(scope, value);
  if (visits.size > 16) visits.delete(visits.keys().next().value!);
}

/** Each canonical topic appears once, including orphaned or cyclic input. */
export function topicRows(threads: readonly Thread[]) {
  const rows: { thread: Thread; depth: number }[] = [];
  const seen = new Set<string>();
  const children = new Map<string | null, Thread[]>();
  const ids = new Set(threads.map(thread => thread.id));
  for (const thread of threads) {
    const parent = thread.parent_id && ids.has(thread.parent_id) ? thread.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), thread]);
  }
  const walk = (root: Thread) => {
    const pending = [{ thread: root, depth: 0 }];
    while (pending.length) {
      const row = pending.pop()!;
      if (seen.has(row.thread.id)) continue;
      seen.add(row.thread.id); rows.push(row);
      pending.push(...(children.get(row.thread.id) ?? []).slice().reverse().map(thread => ({ thread, depth: row.depth + 1 })));
    }
  };
  for (const root of children.get(null) ?? []) walk(root);
  for (const thread of threads) if (!seen.has(thread.id)) walk(thread);
  return rows;
}

export const originalWords = (thought: Thought) => thought.text;
export const referenceOf = (thought: Thought): Reference => ({ id: thought.id, topic: thought.thread_id, words: originalWords(thought), speaker: thought.speaker });
export const emptyNotebook = (): Notebook => ({ text: '', references: [] });
