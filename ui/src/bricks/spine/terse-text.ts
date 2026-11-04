import type { Thought, MapSnapshot } from "../contract";
export const words = (text: string) => text.replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean).length;
export const content = (thought: Thought) => thought.text || thought.point;
/** Presentation cache only; corrections and routing changes invalidate their derived line. */
export function cacheKey(thought: Thought, parent: string) {
  const source = JSON.stringify([content(thought), parent]);
  let a = 2166136261, b = 5381;
  for (const c of source) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
  return `${thought.id}:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export function fallback(text: string) {
  const sentence = text.trim().match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? text.trim();
  const parts = sentence.split(/\s+/).filter(Boolean);
  return `“${parts.slice(0, 12).join(" ")}${parts.length > 12 ? "…" : ""}”`;
}
export function parentLine(text: string) {
  return text.replace(/\b(a|an|the)\b/gi, "").trim().split(/\s+/).slice(0, 12).join(" ");
}
export function groupsOf(map: MapSnapshot, time: boolean) {
  const thoughts = [...map.thoughts].filter(t => content(t).trim()).sort((a,b) => a.at_ms - b.at_ms);
  if (time) {
    const groups: { id: string; title: string; thoughts: Thought[] }[] = [];
    for (const thought of thoughts) {
      const id = thought.thread_id ?? "unplaced";
      let group = groups.at(-1);
      if (!group || group.id !== id) { group = { id, title: map.threads.find(t => t.id === id)?.title ?? "Unsorted thoughts", thoughts: [] }; groups.push(group); }
      group.thoughts.push(thought);
    }
    return groups;
  }
  return [...map.threads.map(thread => ({ id: thread.id, title: thread.title, thoughts: thoughts.filter(t => t.thread_id === thread.id) })),
    { id: "unplaced", title: "Unsorted thoughts", thoughts: thoughts.filter(t => !t.thread_id || !map.threads.some(thread => thread.id === t.thread_id)) }].filter(g => g.thoughts.length);
}
