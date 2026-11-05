import type { Thought, Thread } from "../contract";

export interface TagToken { start: number; end: number; name: string }
export interface TaggedThought {
  id: string;
  text: string;
  speaker: string;
  topic: string;
  threadId: string | null;
  navigable: boolean;
  tags: string[];
}
export interface TagGroup { name: string; count: number }

/** Tags belong to original words, never the model's summary or topic suggestions. */
export function tagTokens(text: string): TagToken[] {
  const pattern = /(?<![\p{L}\p{N}_\/#@])(?:#|hashtag\s+)([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)/giu;
  return Array.from(text.matchAll(pattern), match => ({
    start: match.index!, end: match.index! + match[0].length,
    name: match[1].normalize("NFC").toLowerCase(),
  }));
}

export function tagsIn(text: string): string[] {
  return [...new Set(tagTokens(text).map(token => token.name))];
}

export function taggedThoughts(thoughts: readonly Thought[], threads: readonly Thread[]): TaggedThought[] {
  const topics = new Map(threads.map(thread => [thread.id, thread.title]));
  return thoughts.flatMap(thought => {
    const tags = tagsIn(thought.text);
    if (!tags.length) return [];
    const topic = thought.thread_id ? topics.get(thought.thread_id) : undefined;
    return [{ id: thought.id, text: thought.text, speaker: thought.speaker,
      topic: topic ?? (thought.placed ? "Topic unavailable" : "Waiting for a topic"),
      threadId: thought.thread_id, navigable: thought.placed && topic !== undefined, tags }];
  });
}

export function tagGroups(thoughts: readonly TaggedThought[]): TagGroup[] {
  const counts = new Map<string, number>();
  for (const thought of thoughts) for (const tag of thought.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
