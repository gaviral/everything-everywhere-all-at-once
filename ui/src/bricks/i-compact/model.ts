import type { MapSnapshot } from "../contract";

export type Source = {
  id: string; original: string; concise: string; speaker: string; ai: boolean;
  uncertainty: string; reason: string;
};
export type ReadingTopic = { id: string; title: string; parent: string | null; sources: Source[] };
export type Synthesis = { text: string; revision: string };
export type LocalQuestion = { id: string; text: string; heading: string; revision: string };
export type TopicNotes = { synthesis?: Synthesis; questions: LocalQuestion[] };
export const emptyNotes: TopicNotes = { questions: [] };

export function headingId(id: string) { return `i-compact-topic-${encodeURIComponent(id)}`; }

/** Exact values, rather than a lossy hash: additions, removals and wording changes invalidate edits. */
export function sourceRevision(topic: ReadingTopic) {
  return JSON.stringify([topic.title, topic.parent, topic.sources]);
}

export function mapTopics(map: MapSnapshot): ReadingTopic[] {
  return map.threads.map(topic => ({ id: topic.id, title: topic.title, parent: topic.parent_id,
    sources: map.thoughts.filter(thought => thought.placed && thought.thread_id === topic.id).map(thought => ({
      id: thought.id, original: thought.text, concise: thought.point || thought.text,
      speaker: thought.speaker, ai: map.speakers.get(thought.speaker)?.ai ?? false,
      uncertainty: [thought.unclear, !thought.complete ? "Unfinished thought" : ""].filter(Boolean).join(" · "),
      reason: map.notes[thought.id]?.why || "",
    })),
  }));
}

/** Each topic appears once, including orphaned topics and malformed parent cycles. */
export function topicForest(topics: ReadingTopic[]) {
  const seen = new Set<string>();
  type Branch = { topic: ReadingTopic; children: Branch[] };
  const branch = (topic: ReadingTopic): Branch => {
    seen.add(topic.id);
    return { topic, children: topics.filter(child => child.parent === topic.id && !seen.has(child.id)).map(branch) };
  };
  const roots = topics.filter(topic => !topic.parent || !topics.some(parent => parent.id === topic.parent)).map(branch);
  for (const topic of topics) if (!seen.has(topic.id)) roots.push(branch(topic));
  return roots;
}
