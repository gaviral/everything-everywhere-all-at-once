import type { CodePart, Snapshot } from '../../code-canvas/types';

export const dimensions = ['ui', 'functionality', 'data'] as const;
export type Dimension = typeof dimensions[number];
/** References only. Names, source locations and version scope come from Snapshot.parts. */
export type PartReference = Readonly<Pick<CodePart, 'id' | 'version'>>;
export type Contribution = Readonly<{ part: PartReference; children?: readonly Contribution[] }>;
export type DemoStep = Readonly<{
  id: string;
  title: string;
  description: string;
  contributors: Readonly<Record<Dimension, readonly Contribution[]>>;
}>;
/** Presentation order/topology is supplied by the host; it is never persisted as a catalog. */
export type Presentation = Readonly<{ version: string; steps: readonly DemoStep[] }>;
export type CanonicalGraph = Readonly<Pick<Snapshot, 'parts'>>;
export const dimensionNames: Record<Dimension, string> = { ui: 'UI', functionality: 'Functionality', data: 'Data' };

export const partDimensionsFeature = Object.freeze({
  id: 'part-dimensions',
  defaultEnabled: false,
  readOnly: true,
  control: 'Controlled enabled boolean and onEnabledChange(boolean); off renders the host fallback unchanged.',
});
