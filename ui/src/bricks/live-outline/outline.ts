import type { Thread } from "../contract";

export const QUIET_MS = 120_000;

/** Only these listed fillers are removed. With no filler, even the original spacing stays untouched. */
export function trimFillers(original: string): { text: string; trimmed: boolean } {
  let text = original;
  let previous: string;
  do {
    previous = text;
    text = text
      // A filler enclosed by commas takes its enclosing commas with it.
      .replace(/,\s*(?:um|uh|erm|you\s+know|I\s+mean|like|basically|so\s+yeah)\s*,\s*/gi, " ")
      .replace(/(^\s*|[.!?;:,\n—]\s*)(?:you\s+know|I\s+mean)\b\s*,?\s*/gi, "$1")
      .replace(/(^\s*|[.!?;:,\n—]\s*)basically\s*,\s*/gi, "$1")
      .replace(/(?<![\p{L}\p{N}'’\-])(?:um|uh|erm)(?![\p{L}\p{N}'’\-])[,\t ]*\s*/giu, "")
      .replace(/\blike\s*,\s*/gi, "")
      .replace(/\bso\s+yeah\b\s*,?\s*/gi, "")
      .replace(/(?<![\p{L}\p{N}'’])([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)\s+\1(?![\p{L}\p{N}'’])/giu, "$1");
  } while (text !== previous);

  if (text === original) return { text: original, trimmed: false };
  text = text.replace(/[\t ]{2,}/g, " ").replace(/[\t ]+([,.;:!?])/g, "$1")
    .replace(/[,;:]\s*(?=[.!?])/g, "").replace(/(^|[.!?;:]\s*),[\t ]*/g, "$1").trim();
  if (!/[\p{L}\p{N}]/u.test(text)) text = "";
  return { text, trimmed: true };
}

/** `color` is the room name supplied by map.rooms, never a color inferred from a thread id. */
export type OutlineThread = Pick<Thread, "id" | "title" | "parent_id"> & { color?: string | null };

/** A chronological, local activity stream. Word markers are necessary: landings alone cannot tell whether the
 *  speaker was quiet for two minutes. Only mine landings are recorded; their original text is read from map.thoughts. */
export type OutlineActivity = { kind: "opened" | "words"; at: number } | {
  kind: "landed"; at: number; thoughtId: string; threadId: string; text?: string;
};

export type OutlineRow = { kind: "break"; key: string; at: number } | {
  kind: "thought"; thoughtId: string; threadId: string; text: string;
  level: number; color: string | null; chip: string | null; title: string;
};

/** The current talk only, preceded by its quiet New talk divider. All times are milliseconds. No clock or map reads.
 *  Every landing recomputes the winner (most thoughts, earliest first on a tie) and every row's indentation. */
export function layoutOutline(landings: readonly OutlineActivity[], threads: readonly OutlineThread[], now: number): OutlineRow[] {
  let start = landings[0]?.at ?? now;
  let last = start;
  let current: Extract<OutlineActivity, { kind: "landed" }>[] = [];
  for (const entry of landings) {
    if (entry.kind === "opened" || entry.at - last >= QUIET_MS) {
      start = entry.kind === "opened" ? entry.at : last + QUIET_MS;
      current = [];
    }
    last = entry.at;
    if (entry.kind === "landed" && !current.some((row) => row.thoughtId === entry.thoughtId)) current.push(entry);
  }
  if (now - last >= QUIET_MS) { start = last + QUIET_MS; current = []; }

  const counts = new Map<string, number>();
  for (const landing of current) counts.set(landing.threadId, (counts.get(landing.threadId) ?? 0) + 1);
  let main: string | null = null;
  // Map insertion order is the first landing order, so only a strictly higher count replaces the winner.
  for (const [id, count] of counts) if (main === null || count > counts.get(main)!) main = id;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const rows: OutlineRow[] = [{ kind: "break", key: `talk:${start}`, at: start }];
  for (const landing of current) {
    const thread = byId.get(landing.threadId);
    let level = 0;
    if (landing.threadId !== main) {
      level = 1;
      const seen = new Set([landing.threadId]);
      let parent = thread?.parent_id;
      // An ancestor counts as a side trip when it has actually appeared in this talk. A missing/cyclic link stops.
      while (parent && parent !== main && counts.has(parent) && !seen.has(parent)) {
        level++;
        seen.add(parent);
        parent = byId.get(parent)?.parent_id;
      }
    }
    const title = thread?.title.trim() || "Side trip";
    const words = title.split(/\s+/);
    rows.push({ kind: "thought", thoughtId: landing.thoughtId, threadId: landing.threadId, text: landing.text ?? "",
      level, color: thread?.color ?? null, title,
      chip: level ? words.slice(0, 3).join(" ") + (words.length > 3 ? "…" : "") : null });
  }
  return rows;
}
