export type Term = { term: string; explanation: string };
export type Record = { revision: number; terms: Term[] };
export const EXAMPLES: Term[] = [
  { term: "Wayfinder", explanation: "Example person’s name" },
  { term: "Wide lens", explanation: "Example specialist term" },
];
export const wordKey = (word: string) => word.trim().replace(/\s+/gu, " ").toLowerCase();
export function problem(terms: Term[]): string {
  if (terms.length > 30) return "Keep at most 30 terms.";
  const seen = new Set<string>();
  for (const item of terms) {
    if (!wordKey(item.term) || [...item.term].length > 40 || /\p{Cc}/u.test(item.term)) return "Each term needs 1–40 characters on one line.";
    if ([...item.explanation].length > 160 || /\p{Cc}/u.test(item.explanation)) return "Keep each explanation to 160 characters on one line.";
    const key = wordKey(item.term);
    if (seen.has(key)) return "That term is already in the list, ignoring case and spacing.";
    seen.add(key);
  }
  return terms.reduce((n, row) => n + [...row.term].length + 2, 0) > 1200 ? "Shorten the vocabulary to 1,200 characters including separators." : "";
}
export function isRecord(value: unknown): value is Record {
  if (!value || typeof value !== "object") return false;
  const row = value as Record;
  return Number.isSafeInteger(row.revision) && row.revision >= 0 && Array.isArray(row.terms)
    && row.terms.every(item => item && typeof item.term === "string" && typeof item.explanation === "string") && !problem(row.terms);
}
