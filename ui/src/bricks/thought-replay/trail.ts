import type { MapSnapshot, ThoughtSource } from "../contract";

export type Order = "time" | "topic";
export type Stop = ThoughtSource & { point: string; topic: string };

/** One placed record per stop: equal timestamps never imply that two sources are one turn. */
export function trailOf(map: Pick<MapSnapshot, "thoughts" | "threads">, order: Order): Stop[] {
  const topics = new Map(map.threads.map(thread => [thread.id, thread.title]));
  const chronological = map.thoughts.map((thought, index) => ({ thought, index }))
    .filter(({ thought }) => thought.placed && thought.thread_id && topics.has(thought.thread_id) && (thought.point || thought.text).trim())
    .sort((a, b) => a.thought.at_ms - b.thought.at_ms || a.index - b.index)
    .map(({ thought }) => ({ id: thought.id, text: thought.text, point: thought.point,
      threadId: thought.thread_id!, topic: topics.get(thought.thread_id!)!, at: thought.at_ms, speaker: thought.speaker }));
  if (order === "time") return chronological;
  const rank = new Map(map.threads.map((thread, index) => [thread.id, index]));
  return chronological.sort((a, b) => rank.get(a.threadId)! - rank.get(b.threadId)!);
}

export function readingDelay(stop: Stop, speed: number): number {
  const words = (stop.point === stop.text ? stop.text : `${stop.point} ${stop.text}`).trim().split(/\s+/u).length;
  return Math.max(6000, 2000 + words * 60000 / 200) / speed;
}

export function stopTime(at: number): string {
  return at > 0 && Number.isFinite(at) && !Number.isNaN(new Date(at).getTime())
    ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time not recorded";
}

export const exampleTrail: Stop[] = [
  { id: "example-1", threadId: "example-launch", topic: "The first impression", speaker: "Visitor", at: 0,
    point: "Start with one thought worth following.", text: "When someone opens the demo, give them one thought they can follow all the way through." },
  { id: "example-2", threadId: "example-proof", topic: "Make it tangible", speaker: "Colleague", at: 0,
    point: "Show how the idea became a decision.", text: "Let’s walk from the first idea to the decision. Leave enough time at each stop to read what we actually said." },
  { id: "example-3", threadId: "example-launch", topic: "The first impression", speaker: "Visitor", at: 0,
    point: "Keep the original within reach.", text: "And from any stop, take me back to that exact thought on the map, even if we have added more since then." },
];

export const exampleByTopic = [exampleTrail[0], exampleTrail[2], exampleTrail[1]];
