import type { Thought, Thread } from "../contract";

export type Filters = { query: string; speaker: string | null; theme: string | null; day: string };
export type Source = {
  thought: Thought;
  title: string;
  theme: string;
  day: string;
  date: string;
  fields: string[];
};
const fold = (text: string) => text.normalize("NFC").toLowerCase();

/** A local calendar date, never a UTC date. Zero means the source date is unknown. */
export function localDay(at: number): string {
  if (!at) return "";
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Prepared only when source arrays change; each row owns only that thought's fields. */
export function sourceFields(thoughts: readonly Thought[], threads: readonly Thread[]): Source[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return thoughts.flatMap((thought): Source[] => {
    const thread = thought.thread_id ? byId.get(thought.thread_id) : undefined;
    if (!thought.placed || !thread) return [];
    const day = localDay(thought.at_ms);
    return [{ thought, title: thread.title, theme: thread.topic?.trim() ?? "", day,
      date: day ? new Date(thought.at_ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown date",
      fields: [thought.point, thought.text, thread.title].map(fold) }];
  }).sort((a, b) => b.thought.at_ms - a.thought.at_ms || (a.thought.id < b.thought.id ? -1 : a.thought.id > b.thought.id ? 1 : 0));
}

export function hasFilter(filters: Filters): boolean {
  return !!filters.query.trim() || filters.speaker !== null || filters.theme !== null || !!filters.day;
}

/** Every Unicode query word must occur within a field of this one thought; filters intersect. */
export function filterSources(sources: readonly Source[], filters: Filters): Source[] {
  if (!hasFilter(filters)) return [];
  const words = fold(filters.query).match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  if (filters.query.trim() && !words.length) return [];
  return sources.filter((source) =>
    (filters.speaker === null || source.thought.speaker === filters.speaker)
    && (filters.theme === null || source.theme === filters.theme)
    && (!filters.day || source.day === filters.day)
    && words.every((word) => source.fields.some((field) => field.includes(word))));
}
