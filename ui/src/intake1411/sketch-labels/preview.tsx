import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { sketchLabelsFeature } from './feature';
import { syntheticSketch } from './synthetic';
import { SketchLabels } from './SketchLabels';

export function SyntheticSketchPreview() {
  const parts = useMemo(() => { const drawing = syntheticSketch(); return { drawing, controller: sketchLabelsFeature.create(drawing.adapters) }; }, []);
  const state = useSyncExternalStore(parts.controller.subscribe, parts.controller.read, parts.controller.read);
  useEffect(() => () => parts.controller.dispose(), [parts]);
  return <main className="sketch-labels-preview">
    <div className="sketch-labels"><p>Synthetic preview · isolated session</p>
      <button type="button" disabled={!state.enabled || !state.ready || !!state.session.strokes.length} onClick={parts.drawing.drawThree}>Draw three sample strokes</button>
      <p>Three known mark spans: 1000–1200, 2000–2300, 3000–3300 ms. This preview keeps data in memory for this visit.</p>
    </div>
    <SketchLabels controller={parts.controller} />
  </main>;
}

const root = document.getElementById('sketch-labels-preview');
if (root) createRoot(root).render(<SyntheticSketchPreview />);
