import type { MapSnapshot } from "../contract";

export type SourceBlock = { id: string; text: string; by: string; thoughtId?: string };
export type ReadingDocument = { id: string; title: string; kind: string; blocks: SourceBlock[] };

// Identity follows the source, never the heading, array position or arrival order.
export function documentsOf(map: MapSnapshot): ReadingDocument[] {
  const topics = map.threads.map(topic => ({
    id: `topic:${topic.id}`, title: topic.title, kind: "Conversation · original words",
    blocks: map.thoughts.filter(thought => thought.placed && thought.thread_id === topic.id)
      .map(thought => ({ id: thought.id, text: thought.text || thought.point, by: thought.speaker, thoughtId: thought.id })),
  }));
  const results = map.jobs.filter(job => job.result).map(job => ({
    id: `helper:${JSON.stringify([job.by, job.id])}`, title: job.title,
    kind: `${job.demo ? "Simulated helper" : "Helper"} · ${job.status} · history`,
    blocks: [{ id: `result:${job.id}`, text: job.result!, by: job.by }],
  }));
  return [...topics, ...results];
}

export const exampleDocuments: ReadingDocument[] = [{
  id: "example:library", title: "A little library, close to home", kind: "Example conversation · fictional",
  blocks: [
    { id: "example:why", by: "Maya · example", text: "Start with one neighbourhood. A two-week library pilot will tell us whether neighbours come back to borrow again." },
    { id: "example:how", by: "Sam · example", text: "Invite twenty households for Saturday. Keep a quiet corner for reading, and ask what they would like to borrow next." },
    { id: "example:next", by: "Maya · example", text: "Before we expand, look at repeat visits. Leave room for the people who need a little longer to find their next book." },
  ],
}, {
  id: "example:helper", title: "A helper’s suggestion", kind: "Example helper result · history",
  blocks: [{ id: "example:result", by: "Helper · example", text: "Try a simple lending notebook for the first fortnight. Count returning households before choosing a larger system. This is a suggestion from an example, with no approval or action attached." }],
}];
