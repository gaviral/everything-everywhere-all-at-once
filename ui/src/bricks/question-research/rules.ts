import type { Citation, ResearchKept, Thought } from "../contract";
export function safeCitation(c: Citation, answer: string) {
  try { const u = new URL(c.url); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !/[\s\x00-\x1f]/.test(c.url) && c.start >= 0 && c.start < c.end && c.end <= [...answer].length && !!c.title.trim() && !/[<>]/.test(c.title); } catch { return false; }
}
export function sourceState(answer: Readonly<ResearchKept>, thoughts: readonly Thought[], threads: readonly { id: string }[]) {
  const t = thoughts.find(t => t.id === answer.thought_id && t.placed && threads.some(th => th.id === t.thread_id));
  return !t ? "Source no longer on map" : t.text !== answer.quote || (answer.source_point !== undefined && t.point !== answer.source_point) || t.thread_id !== answer.topic_id ? "Source changed" : "";
}
export function answerParts(answer: string, citations: readonly Citation[]) {
  const chars = [...answer];
  const valid = citations.filter(c => safeCitation(c, answer));
  const edges = [...new Set([0, chars.length, ...valid.flatMap(c => [c.start, c.end])])].sort((a,b) => a-b);
  return edges.slice(0,-1).map((start,i) => ({ start, text: chars.slice(start,edges[i+1]).join(""), supported: valid.some(c => c.start <= start && c.end >= edges[i+1]), citations: valid.filter(c => c.end === edges[i+1]) }));
}
