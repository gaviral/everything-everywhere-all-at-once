import type { MapSnapshot, QuestionInput } from "../contract";

export function problem(input: Pick<QuestionInput, "text" | "answer">): string | null {
  if (!input.text.trim() || Array.from(input.text).length > 280) return "Question needs 1–280 characters.";
  if (Array.from(input.answer).length > 2000) return "Answer allows at most 2,000 characters.";
  return null;
}

/** Read at the Save click, never when the checkbox is selected. */
export function latestThought(map: MapSnapshot): string | null {
  return map.thoughts.filter(t => t.placed && t.thread_id === map.active && map.threads.some(thread => thread.id === t.thread_id))
    .reduce<(typeof map.thoughts)[number] | null>((last, t) => !last || t.at_ms >= last.at_ms ? t : last, null)?.id ?? null;
}
