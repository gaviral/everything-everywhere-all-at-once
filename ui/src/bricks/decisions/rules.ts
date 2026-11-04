import type { Thought, Thread } from "../contract";

/** Only the map's recorded flag counts. Suggestions and recap prose never enter this list. */
export function decisionsOf(thoughts: readonly Thought[], threads: readonly Thread[], topic: string | null | undefined) {
  const placedTopics = new Set(threads.map(thread => thread.id));
  return thoughts.filter(thought => thought.placed && thought.decided === true
    && thought.thread_id !== null && placedTopics.has(thought.thread_id)
    && (topic === undefined || thought.thread_id === topic))
    .sort((a, b) => b.at_ms - a.at_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
