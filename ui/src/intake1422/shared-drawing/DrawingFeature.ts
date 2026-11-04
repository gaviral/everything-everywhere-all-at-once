export const drawingFeature = Object.freeze({
  id: 'intake1422-shared-drawing',
  name: 'Shared drawing',
  defaultEnabled: false,
  control: 'SketchSessionAdapter.setEnabled(boolean)',
  preview: '/src/intake1422/shared-drawing/preview.html',
  requires: 'Injected DrawingSessionPort for the existing canonical sketch and destination session',
});
