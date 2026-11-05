import { SketchLabelsController } from './controller';
import type { SketchLabelsAdapters } from './contracts';

export const sketchLabelsFeature = Object.freeze({
  id: 'intake1411-sketch-labels',
  title: 'Sketch labels',
  defaultEnabled: false,
  create: (adapters: SketchLabelsAdapters) => new SketchLabelsController(adapters),
});
