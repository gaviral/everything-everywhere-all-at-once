import type { MapSnapshot, Thought, Thread } from "../contract";

export type MarginNote = { id: string; quote: string; thoughts: readonly Thought[] };
export type Passage = { thought: Thought; notes: MarginNote[] };
export type ReadingSection = { id: string; title: string; archived: boolean; passages: Passage[]; children: ReadingSection[] };

/** Anchored replies stay beside their source; ordinary tangents keep their hierarchy. */
export function readingSections(map: Pick<MapSnapshot, "threads" | "thoughts">): ReadingSection[] {
  const topics = new Set(map.threads.map(thread => thread.id));
  const placed = map.thoughts.filter(thought => thought.placed && thought.thread_id && topics.has(thought.thread_id));
  const sources = new Set(placed.map(thought => thought.id));
  const byTopic = new Map<string, Thought[]>();
  for (const thought of [...placed].sort((a, b) => a.at_ms - b.at_ms)) {
    const list = byTopic.get(thought.thread_id!) ?? [];
    list.push(thought);
    byTopic.set(thought.thread_id!, list);
  }
  const notes = new Map<string, MarginNote[]>();
  const attached = new Set<string>();
  for (const thread of map.threads) {
    if (!thread.anchor || !sources.has(thread.anchor.thought_id) || !byTopic.has(thread.id)) continue;
    const list = notes.get(thread.anchor.thought_id) ?? [];
    list.push({ id: thread.id, quote: thread.anchor.quote, thoughts: byTopic.get(thread.id)! });
    notes.set(thread.anchor.thought_id, list);
    attached.add(thread.id);
  }
  const nodes = new Map<string, ReadingSection>();
  for (const thread of map.threads) {
    if (attached.has(thread.id)) continue;
    nodes.set(thread.id, { id: thread.id, title: thread.title || "Untitled topic", archived: thread.status === "dropped",
      passages: (byTopic.get(thread.id) ?? []).map(thought => ({ thought, notes: notes.get(thought.id) ?? [] })), children: [] });
  }
  // Walk from roots, then any disconnected/cyclic branches, showing every topic once.
  const visited = new Set<string>();
  const children = new Map<string, Thread[]>();
  for (const thread of map.threads) if (thread.parent_id) {
    const list = children.get(thread.parent_id) ?? [];
    list.push(thread); children.set(thread.parent_id, list);
  }
  const visit = (id: string): ReadingSection | null => {
    const node = nodes.get(id);
    if (!node || visited.has(id)) return null;
    visited.add(id);
    node.children = (children.get(id) ?? []).flatMap(child => {
      const found = visit(child.id); return found ? [found] : [];
    });
    return node.passages.length || node.children.length ? node : null;
  };
  const roots: ReadingSection[] = [];
  const add = (id: string) => { const node = visit(id); if (node) roots.push(node); };
  for (const thread of map.threads) if (!thread.parent_id || !nodes.has(thread.parent_id)) add(thread.id);
  for (const id of nodes.keys()) if (!visited.has(id)) add(id);
  return roots;
}

export function sectionPlaces(sections: ReadingSection[], parents: string[] = []): { section: ReadingSection; parents: string[] }[] {
  return sections.flatMap(section => [{ section, parents }, ...sectionPlaces(section.children, [...parents, section.id])]);
}

const exampleThought = (id: string, speaker: string, text: string, minute: number): Thought => ({
  id, speaker, text, point: text, thread_id: "example", placed: true, unclear: "", complete: true,
  at_ms: Date.UTC(2026, 0, 12, 18, minute), place_ms: null,
});

export const exampleSections: ReadingSection[] = [
  { id: "example-purpose", title: "Make room for a first visit", archived: false, children: [], passages: [
    { thought: exampleThought("example-1", "Mira", "A neighbourhood library should feel like an invitation. Start with twenty households, a small shelf of useful things, and one Saturday together.", 0), notes: [
      { id: "example-note", quote: "one Saturday together", thoughts: [exampleThought("example-question", "Jules", "Could we offer a quieter hour for people who prefer a smaller group?", 2)] },
    ] },
    { thought: exampleThought("example-2", "Jules", "Keep the first visit simple: borrow one thing, meet a neighbour, and know when to come back. We can learn from what people actually use.", 4), notes: [] },
  ] },
  { id: "example-learn", title: "Learn before growing", archived: false, passages: [
    { thought: exampleThought("example-3", "Mira", "After two weeks, ask which objects came back and which were borrowed again. Repeat borrowing could tell us more than the number of sign-ups.", 7), notes: [] },
  ], children: [
    { id: "example-open", title: "An open question", archived: false, children: [], passages: [
      { thought: exampleThought("example-4", "Jules", "We still need to decide who looks after repairs. Let’s ask the first group what they would feel comfortable taking on.", 9), notes: [] },
    ] },
  ] },
];
