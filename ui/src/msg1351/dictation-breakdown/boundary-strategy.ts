import { characters } from "./source-span";

export type CuePart = "word" | "phrase" | "regex" | "fuzzy";
export type SpeakerProfile = Readonly<{ id: string; name: string; parts: readonly CuePart[] }>;
export const speakerProfiles: readonly SpeakerProfile[] = Object.freeze([
  { id: "careful", name: "Careful phrases", parts: ["phrase", "regex"] },
  { id: "expressive", name: "More cue suggestions", parts: ["word", "phrase", "regex", "fuzzy"] },
  { id: "manual", name: "Manual only", parts: [] },
]);
export const wordCue = (text: string) => /^(next|anyway)\b/i.test(text);
export const phraseCue = (text: string) => /^(on another topic|back to|returning to)\b/i.test(text);
export const regexCue = (text: string) => /^item\s+\d+\s*:/i.test(text);
function editDistance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(left[i] !== right[j])));
    row = next;
  }
  return row[right.length];
}
export function fuzzyCue(text: string) {
  const phrase = text.toLowerCase().split(/\s+/).slice(0, 3).join(" ").replace(/[,.:;!?]+$/, "");
  return phrase.length >= 12 && editDistance(phrase, "on another topic") <= 1;
}
const cueParts = { word: wordCue, phrase: phraseCue, regex: regexCue, fuzzy: fuzzyCue };

/** Candidates only at sentence/line/semicolon starts, outside quoted speech. */
function eligibleOffsets(source: string): number[] {
  const chars = characters(source), offsets: number[] = [];
  let quote = "", boundary = true;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (quote) { if (char === quote && chars[i - 1] !== "\\") quote = ""; continue; }
    const apostrophe = char === "'" && /[\p{L}\p{N}]/u.test(chars[i - 1] ?? "");
    if (!apostrophe && ["\"", "'", "“", "‘"].includes(char)) { quote = char === "“" ? "”" : char === "‘" ? "’" : char; boundary = false; continue; }
    if (/\s/u.test(char)) { if (char === "\n") boundary = true; continue; }
    if (boundary && i > 0) offsets.push(i);
    boundary = /[.!?;]/.test(char);
  }
  return offsets;
}
export function proposedBoundaries(source: string, profile: SpeakerProfile): number[] {
  const chars = characters(source);
  return eligibleOffsets(source).filter(offset => profile.parts.some(part => cueParts[part](chars.slice(offset).join(""))));
}
