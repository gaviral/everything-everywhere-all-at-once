import type { Evidence } from "./types";
export function exactPart(text: string): Evidence | undefined {
  const phrase = ["another thing", "by the way"].find(value => text.toLowerCase().startsWith(value) && !/[\p{L}\p{N}_]/u.test(text[value.length] ?? ""));
  if (phrase) return { matcher: "exact", phrase: text.slice(0, phrase.length), reason: `Matches “${phrase}” exactly, ignoring letter case.` };
}
