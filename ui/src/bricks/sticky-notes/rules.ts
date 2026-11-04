import type { Thought, Thread } from "../contract";

export const NOTE_LIMIT = 12;
export const DRAFT_LIMIT = 6000;
/** References plus the last observed quote, solely for a source that leaves the map. Never World data. */
export interface Reference { id: string; quote: string; topic: string; speaker: string }
export interface Layout { version: 1; references: Reference[]; draft: string }
export const emptyLayout = (): Layout => ({ version: 1, references: [], draft: "" });
export const layoutKey = (map: string, speaker: string) => `e2a2o.sticky-notes.${JSON.stringify([map, speaker])}`;

/** Unknown versions and malformed storage are left untouched, rather than silently erasing saved work. */
export function decodeLayout(raw: string | null): Layout | null {
  if (raw === null) return emptyLayout();
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.references) || value.references.length > NOTE_LIMIT
      || typeof value.draft !== "string" || value.draft.length > DRAFT_LIMIT) return null;
    const ids = new Set<string>();
    for (const reference of value.references) {
      if (!reference || typeof reference.id !== "string" || !reference.id || ids.has(reference.id)
        || ![reference.quote, reference.topic, reference.speaker].every(part => typeof part === "string")) return null;
      ids.add(reference.id);
    }
    return { version: 1, references: value.references.map((r: Reference) => ({ id: r.id, quote: r.quote, topic: r.topic, speaker: r.speaker })), draft: value.draft };
  } catch { return null; }
}

export function referenceOf(thought: Thought, threads: readonly Thread[]): Reference {
  return { id: thought.id, quote: thought.text, speaker: thought.speaker,
    topic: threads.find(thread => thread.id === thought.thread_id)?.title ?? "Unplaced thought" };
}

/** ID, never text, is identity: two people may say exactly the same words. */
export function pin(layout: Layout, thought: Thought, threads: readonly Thread[]): Layout {
  if (layout.references.length >= NOTE_LIMIT || layout.references.some(reference => reference.id === thought.id)) return layout;
  return { ...layout, references: [...layout.references, referenceOf(thought, threads)] };
}

export function refresh(layout: Layout, thoughts: readonly Thought[], threads: readonly Thread[]): Layout {
  const sources = new Map(thoughts.map(thought => [thought.id, thought]));
  let changed = false;
  const references = layout.references.map(reference => {
    const source = sources.get(reference.id);
    if (!source) return reference;
    const next = referenceOf(source, threads);
    if (next.quote === reference.quote && next.topic === reference.topic && next.speaker === reference.speaker) return reference;
    changed = true;
    return next;
  });
  return changed ? { ...layout, references } : layout;
}
