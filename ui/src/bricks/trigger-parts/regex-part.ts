import type { Evidence } from "./types";
export function regexPart(text: string): Evidence | undefined {
  const match = /^(?:next up\s*:|item\s+\d+\s*:)/i.exec(text);
  if (match) return { matcher: "regex", phrase: match[0], reason: "Matches “next up:” or a numbered “item N:” cue." };
}
