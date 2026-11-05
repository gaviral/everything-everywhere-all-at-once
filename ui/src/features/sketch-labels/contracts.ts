export type Point = Readonly<{ x: number; y: number }>;
export type TimeSpan = Readonly<{ startMs: number; endMs: number }>;
export type Stroke = Readonly<{ id: string; points: readonly (Point & { atMs: number })[] }>;
export type SketchSession = Readonly<{ id: string; strokes: readonly Stroke[] }>;
export type Region = Readonly<{ id: string; bounds: Readonly<{ x: number; y: number; width: number; height: number }> }>;
export type Selection =
  | Readonly<{ kind: 'strokes'; strokeIds: readonly string[] }>
  | Readonly<{ kind: 'region'; region: Region }>;
export type SuppliedReference = Readonly<{
  id: string;
  text: string;
  source: 'typed' | 'prerecorded';
  utteranceTime: TimeSpan | null;
}>;
export type Anchor = Readonly<{
  target: Selection;
  strokeTime: TimeSpan | null;
  reference: SuppliedReference;
  uncertainty: 'separate-times' | 'reference-time-missing';
}>;
export type Annotation = Readonly<{ id: string; sessionId: string; label: string; anchor: Anchor }>;

/** The owner supplies an immutable session snapshot and a subscription. No drawing writes. */
export interface StrokeSessionAdapter {
  read(): SketchSession;
  subscribe(changed: () => void): () => void;
}
/** Synchronous atomic replacement: throw on failure, without changing saved data.
 * The host owns durable storage and conflict serialization for this namespace. */
export interface AnnotationStore {
  read(sessionId: string): readonly Annotation[];
  replace(sessionId: string, annotations: readonly Annotation[]): void;
}
export interface SketchLabelsAdapters {
  strokes: StrokeSessionAdapter;
  annotations: AnnotationStore;
  newId(): string;
}
