// Topics (core/src/topics.rs): the AI sorts the map's top threads under a few topics it names, and a person can rename a
// topic or move a thread under another. Here: the window's copy of the core's `World::topics` (top thread id → name),
// kept by the core's changes (core.ts `apply`); what bricks get from it, each thread's topic and the topics in order
// (bricks-core.ts `snapshotOf`); and how a brick's rename or move reaches the core (core.ts registers the sender).
import type { Thread, World } from "./core";
import { TOPIC_MAX } from "./limits";

export type Assigned = { thread_id: string; topic: string };
export type TopicChange =
  | { type: "topics_assigned"; assigned: Assigned[] }
  | { type: "topic_set"; thread_id: string; topic: string }
  | { type: "topic_renamed"; from: string; to: string };

const KINDS = new Set(["topics_assigned", "topic_set", "topic_renamed"]);
export const isTopicChange = (change: { type: string }): change is TopicChange => KINDS.has(change.type);

/** A topic change on the window's map, as the core's `World::apply` makes it: by the ids as given, only for a thread on
 *  the map, never an empty name; a rename moves every thread under the old name, on the map or not (an Undo that brings
 *  a thread back brings its topic). */
export function applyTopic(world: World, change: TopicChange): World {
  const was = world.topics ?? {};
  const next: Record<string, string> = { ...was };
  let changed = false;
  const put = (id: string, name: string) => {
    if (!name.trim() || next[id] === name || !world.threads.some((t) => t.id === id)) return;
    next[id] = name;
    changed = true;
  };
  if (change.type === "topics_assigned") for (const a of change.assigned) put(a.thread_id, a.topic);
  else if (change.type === "topic_set") put(change.thread_id, change.topic);
  else if (change.to.trim() && change.to !== change.from) {
    for (const [id, name] of Object.entries(was)) if (name === change.from) { next[id] = change.to; changed = true; }
  }
  return changed ? { ...world, topics: next } : world;
}

/** A name as a person typed it, as the core keeps it (topics.rs `typed`): spaces as one, at most `TOPIC_MAX`
 *  characters; null when there's none. */
export function topicName(raw: string): string | null {
  const name = [...raw.trim().split(/\s+/).join(" ")].slice(0, TOPIC_MAX).join("").trimEnd();
  return name || null;
}

/** What tells two names apart, as the core reads them (topics.rs `key`): letters and digits, any case; "&" is "and". */
export const topicKey = (name: string) => name.replace(/&/g, " and ").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w.toLowerCase()).join(" ");

/** The topics on the window's map, in the order they first come among its top threads. */
export function topicNames(world: Pick<World, "threads" | "topics">): string[] {
  const on = new Set(world.threads.map((t) => t.id));
  const names: string[] = [];
  for (const t of world.threads) {
    const name = world.topics?.[t.id];
    if (name && (!t.parent_id || !on.has(t.parent_id)) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The change the core makes for a person's rename (topics.rs `rename`), for the playground, which has no core; null
 *  when it would refuse it or there's nothing to do. A name already there (in any case) makes the two one. */
export function renameChange(world: World, from: string, to: string): TopicChange | null {
  const typed = topicName(to);
  const names = topicNames(world);
  if (!typed || !names.includes(from)) return null;
  const name = names.find((n) => n !== from && topicKey(n) === topicKey(typed)) ?? typed;
  return name === from ? null : { type: "topic_renamed", from, to: name };
}

/** The change the core makes for a person's move (topics.rs `set`), for the playground: the thread's top thread goes,
 *  under a name already there when one matches in any case; null when it would refuse it or it's there already. */
export function moveChange(world: World, threadId: string, topic: string): TopicChange | null {
  const typed = topicName(topic);
  const byId = new Map(world.threads.map((t) => [t.id, t]));
  let top = byId.get(world.merged[threadId] ?? threadId);
  if (!typed || !top) return null;
  for (let step = 0; step < world.threads.length && top.parent_id && byId.has(top.parent_id); step++) top = byId.get(top.parent_id)!;
  const name = topicNames(world).find((n) => topicKey(n) === topicKey(typed)) ?? typed;
  return world.topics?.[top.id] === name ? null : { type: "topic_set", thread_id: top.id, topic: name };
}

/** A topic on the map: its name and how many top threads it holds (contract.ts `Topic`). */
export type TopicCount = { name: string; threads: number };

/** Each thread with the topic of the top thread it's under (`topic`; a branch has its top thread's, and one whose parent
 *  left the map stands on its own), and the topics in the order they first come among the top threads, with how many
 *  each holds: what bricks get (contract.ts). The same objects while the threads and topics stay the same, and a thread
 *  whose topic didn't change keeps its object. */
export function topicsOf<T extends Thread>() {
  let last: { threads: readonly T[]; topics: Record<string, string> | undefined; out: { threads: readonly (T & { topic?: string })[]; topics: TopicCount[] } } | null = null;
  return (threads: readonly T[], topics: Record<string, string> | undefined) => {
    if (last && last.threads === threads && last.topics === topics) return last.out;
    const byId = new Map(threads.map((t) => [t.id, t]));
    const topOf = (t: T) => {
      let top = t;
      for (let step = 0; step < threads.length && top.parent_id && byId.has(top.parent_id); step++) top = byId.get(top.parent_id)!;
      return top;
    };
    const counts: TopicCount[] = [];
    let moved = false;
    const out = threads.map((t) => {
      const top = topOf(t);
      const topic = topics?.[top.id];
      if (topic && top === t) {
        const count = counts.find((c) => c.name === topic);
        if (count) count.threads++;
        else counts.push({ name: topic, threads: 1 });
      }
      const had = (t as T & { topic?: string }).topic;
      if (had === topic) return t as T & { topic?: string };
      moved = true;
      if (topic) return { ...t, topic };
      const { topic: _gone, ...rest } = t as T & { topic?: string };
      return rest as T & { topic?: string };
    });
    last = { threads, topics, out: { threads: moved ? out : threads, topics: counts } };
    return last.out;
  };
}

/** Where a rename or a move goes: the window's connection to the core (core.ts `useCore` sets it), which says when it
 *  couldn't send. None yet: nothing goes. */
let sender: ((message: string) => boolean) | null = null;
export function sendTopicsWith(send: (message: string) => boolean): () => void {
  sender = send;
  return () => { if (sender === send) sender = null; };
}

/** A brick's `renameTopic` in the app: false when there's no name, it's unchanged, or the window couldn't send it. */
export function renameTopic(from: string, to: string): boolean {
  const name = topicName(to);
  if (!name || name === from || !sender) return false;
  return sender(JSON.stringify({ type: "topic_rename", from, to: name }));
}

/** A brick's `moveToTopic` in the app: false when there's no name or the window couldn't send it. */
export function moveToTopic(threadId: string, topic: string): boolean {
  const name = topicName(topic);
  if (!name || !threadId || !sender) return false;
  return sender(JSON.stringify({ type: "topic_set", thread_id: threadId, topic: name }));
}
