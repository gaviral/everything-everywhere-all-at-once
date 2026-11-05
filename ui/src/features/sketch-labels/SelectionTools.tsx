import { useState } from 'react';
import type { SketchLabelsController, SketchLabelsState } from './controller';
import { targetText } from './AnnotationView';

export type SelectionMode = 'lasso' | 'highlight';
export function SelectionTools({ controller, state, mode, setMode, run }: {
  controller: SketchLabelsController; state: SketchLabelsState; mode: SelectionMode;
  setMode: (mode: SelectionMode) => void; run: (operation: () => void) => void;
}) {
  const [bounds, setBounds] = useState([340, 200, 160, 70]);
  const ids = state.selection?.kind === 'strokes' ? state.selection.strokeIds : [];
  return <section aria-label="Selection tools" className="sketch-labels-tools">
    <div className="sketch-labels-row" role="group" aria-label="Selection mode">
      <button type="button" aria-pressed={mode === 'lasso'} onClick={() => setMode('lasso')}>Lasso marks</button>
      <button type="button" aria-pressed={mode === 'highlight'} onClick={() => setMode('highlight')}>Highlight region</button>
      <button type="button" onClick={() => run(() => controller.clearSelection())}>Clear selection</button>
    </div>
    <p id="sketch-labels-selection-help">{mode === 'lasso' ? 'Trace a closed loop around whole marks. Only fully enclosed marks are selected.' : 'Drag a rectangle over content to highlight it. This creates a separate region.'} You can also use the controls below.</p>
    <fieldset><legend>Choose exact marks</legend><div className="sketch-labels-row">
      {state.session.strokes.map(stroke => <label key={stroke.id} className="sketch-labels-mark-choice">
        <input type="checkbox" checked={ids.includes(stroke.id)} onChange={event => run(() => controller.selectIds(event.target.checked ? [...ids, stroke.id] : ids.filter(id => id !== stroke.id)))} />
        {stroke.id}
      </label>)}
      {!state.session.strokes.length && <span>No marks yet.</span>}
    </div></fieldset>
    <details><summary>Highlight using coordinates</summary><div className="sketch-labels-region-fields">
      {['Left', 'Top', 'Width', 'Height'].map((label, index) => <label key={label}>{label}<input type="number" min="0" max={index % 2 === 0 ? 640 : 340} value={bounds[index]} onChange={event => setBounds(bounds.map((value, i) => i === index ? Number(event.target.value) : value))} /></label>)}
      <button type="button" onClick={() => run(() => {
        const [x, y, width, height] = bounds;
        if (x + width > 640 || y + height > 340) throw new Error('Keep the region inside the drawing.');
        controller.highlight({ x, y }, { x: x + width, y: y + height });
      })}>Select region</button>
    </div></details>
    <p className="sketch-labels-target" data-selection="true">{state.selection ? targetText(state.selection) : 'Unresolved target — choose marks or a region.'}</p>
  </section>;
}
