import type { ReactNode } from "react";

/** Exact, caller-supplied decision phrases; no inferred commitments or rewritten words. */
export function DecisionEmphasis({ text, phrases = [] }: { text: string; phrases?: readonly string[] }) {
  const matches = [...new Set(phrases)].filter(Boolean).sort((a, b) => b.length - a.length);
  const parts: ReactNode[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const phrase = matches.find(value => text.startsWith(value, cursor));
    if (!phrase) { cursor++; continue; }
    if (cursor > start) parts.push(text.slice(start, cursor));
    parts.push(<strong className="reading-format-emphasis" key={cursor}>{phrase}</strong>);
    cursor += phrase.length;
    start = cursor;
  }
  if (start < text.length) parts.push(text.slice(start));
  return <>{parts}</>;
}
