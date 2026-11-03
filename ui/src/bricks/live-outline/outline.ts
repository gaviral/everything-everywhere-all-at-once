export const QUIET_MS = 120_000;

/** How far a side trip steps in: a fourth level, and anything deeper, sits at 3. */
export const MAX_LEVEL = 3;

/** Only these listed fillers are removed. With no filler, even the original spacing stays untouched. */
export function trimFillers(original: string): { text: string; trimmed: boolean } {
  let text = original;
  let previous: string;
  do {
    previous = text;
    text = text
      // A filler enclosed by commas takes its enclosing commas with it.
      .replace(/,\s*(?:um|uh|erm|you\s+know|I\s+mean|like|basically|so\s+yeah)\s*,\s*/gi, " ")
      // These phrases need a following comma; unpunctuated words keep their meaning.
      .replace(/(^\s*|[.!?;:,\n—]\s*)(?:you\s+know|I\s+mean)\b\s*,\s*/gi, "$1")
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

/** `color` is the room name supplied by map.rooms, never a color inferred from a thread id. A thread's parent link plays
 *  no part: the levels come from the order you said things in. */
export type OutlineThread = { id: string; title: string; color?: string | null };

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
 *  Every landing recomputes the main line (most thoughts, earliest first on a tie) and every row's indentation.
 *  Conversation is a stack, the main line its bottom: a thought in a thread that isn't on the stack steps in one level
 *  (a push); one in a thread that is on it steps back out to that thread's level (a pop). */
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
  // The main line is there from the start, even when the first thing said was a side trip: it is the whole talk's.
  const stack: string[] = main === null ? [] : [main];
  for (const landing of current) {
    const at = stack.indexOf(landing.threadId);
    if (at < 0) stack.push(landing.threadId);
    else stack.length = at + 1;
    // The stack keeps its true depth, so coming back out lands on the right level; only the drawing is capped.
    const level = Math.min(stack.length - 1, MAX_LEVEL);
    const thread = byId.get(landing.threadId);
    const title = thread?.title.trim() || "Side trip";
    const words = title.split(/\s+/);
    rows.push({ kind: "thought", thoughtId: landing.thoughtId, threadId: landing.threadId, text: landing.text ?? "",
      level, color: thread?.color ?? null, title,
      chip: landing.threadId === main ? null : words.slice(0, 3).join(" ") + (words.length > 3 ? "…" : "") });
  }
  return rows;
}
