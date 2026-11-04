import type { SelectedSource, Source, SourceAnchor } from "./contracts";

export function anchorSelection(selected: SelectedSource | null): SourceAnchor | null {
  if (!selected?.selection) return null;
  const { source, selection: { start, end, quote } } = selected;
  if (!source.id || !source.revision || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > source.text.length || !quote.trim()
    || source.text.slice(start, end) !== quote) return null;
  // Never search for a matching word: the explicit range disambiguates repeated terms.
  return Object.freeze({ ...source, start, end, quote });
}

export function anchorIsCurrent(anchor: SourceAnchor, source: Source | undefined): boolean {
  return !!source && source.id === anchor.id && source.revision === anchor.revision
    && source.text === anchor.text && source.text.slice(anchor.start, anchor.end) === anchor.quote;
}
