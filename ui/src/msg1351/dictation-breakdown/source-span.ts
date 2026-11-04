import type { Item, SourceSpan } from "./contract";

export const characters = (source: string) => Array.from(source);
export function sourceSpan(source: string, start: number, end: number): SourceSpan {
  const chars = characters(source);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > chars.length)
    throw new Error("Choose a nonempty source range.");
  return Object.freeze({ start, end, text: chars.slice(start, end).join("") });
}
export function assertCoverage(source: string, items: readonly Item[]) {
  let offset = 0;
  for (const item of items) {
    const span = sourceSpan(source, item.source.start, item.source.end);
    if (span.start !== offset || span.text !== item.source.text) throw new Error("Source coverage changed.");
    offset = span.end;
  }
  if (offset !== characters(source).length) throw new Error("Some source text is missing.");
}
