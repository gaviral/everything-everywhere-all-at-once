export const WORD_LIMIT = 6000;
export const EXAMPLE = "Meet at the pair before the garden event.";
export type Draft = { original: string; text: string; example: boolean; phase: "editing" | "preview" | "submitted" | "refused" };
export const makeDraft = (text: string, example = false): Draft => ({ original: text, text, example, phase: "editing" });
export function wordError(text: string): string {
  if (!text.trim()) return "Add words before continuing.";
  if (Array.from(text).length > WORD_LIMIT) return "Use at most 6,000 characters. Your full text stays here.";
  return "";
}
