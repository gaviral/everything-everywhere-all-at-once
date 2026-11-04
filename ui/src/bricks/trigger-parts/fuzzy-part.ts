import type { Evidence } from "./types";
function distance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(left[i] !== right[j])));
    row = next;
  }
  return row[right.length];
}
export function fuzzyPart(text: string): Evidence | undefined {
  const phrase = /^[\p{L}]+\s+[\p{L}]+\s+[\p{L}]+/u.exec(text)?.[0];
  if (!phrase) return;
  const normalized = phrase.toLowerCase().replace(/\s+/g, " ");
  const edits = distance(normalized, "by the way");
  if (edits > 0 && edits <= 2) return { matcher: "fuzzy", phrase, reason: `${edits} letter edits from “by the way”. A suggestion, not certainty.` };
}
