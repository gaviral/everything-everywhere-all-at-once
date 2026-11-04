export type Source = Readonly<{ id: string; revision: string; text: string }>;
export type SelectedSource = Readonly<{
  source: Source;
  selection: Readonly<{ start: number; end: number; quote: string }> | null;
  known?: boolean;
  critical?: boolean;
}>;

/** Stable snapshots; ranges use UTF-16 offsets, as browser text selections do.
 * A revision must change with text. Restore returns false if the place no longer exists.
 * The host owns selection, persistence, and any navigation outside this view. */
export interface SelectedSourceAdapter<Place> {
  getSnapshot(): SelectedSource | null;
  subscribe(listener: () => void): () => void;
  capturePlace(): Place;
  restorePlace(place: Place, anchor: SourceAnchor): boolean;
}

export type SourceAnchor = Readonly<Source & { start: number; end: number; quote: string }>;
export type Question<Place> = Readonly<{
  anchor: SourceAnchor;
  place: Place;
  understanding: string;
  status: "asking" | "resolved" | "dismissed";
  lookupRequired: boolean;
}>;
