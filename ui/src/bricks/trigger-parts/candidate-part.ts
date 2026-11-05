import { characters, sourceSpan } from "../../features/dictation-breakdown/source-span";
import type { Candidate } from "./types";

/** Offsets use the shared contract's Unicode scalar units, including emoji. */
export function candidates(source: string): Candidate[] {
  const chars = characters(source);
  const starts: number[] = [];
  let boundary = true, quote = "";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (quote) { if (char === quote && chars[i - 1] !== "\\") quote = ""; continue; }
    if (/\s/u.test(char)) { if (char === "\n") boundary = true; continue; }
    const apostrophe = char === "'" && /[\p{L}\p{N}]/u.test(chars[i - 1] ?? "");
    if (!apostrophe && ['"', "'", "“", "‘"].includes(char)) {
      quote = char === "“" ? "”" : char === "‘" ? "’" : char;
      boundary = false; continue;
    }
    if (boundary) starts.push(i);
    boundary = /[.!?;:，,]/u.test(char);
  }
  return starts.map((start, index) => ({ id: `cue-${start}`, source: sourceSpan(source, start, starts[index + 1] ?? chars.length) }));
}
