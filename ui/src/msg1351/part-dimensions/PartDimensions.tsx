import { useState, type ReactNode } from 'react';
import type { CanonicalGraph, Dimension, PartReference, Presentation } from './contract';
import { dimensionNames, dimensions } from './contract';
import { SequenceView } from './SequenceView';
import { ContributionTree } from './ContributionTree';
import { ViewVersion } from './ViewVersion';
import './part-dimensions.css';

export function PartDimensionsControl({ enabled, onEnabledChange }: { enabled: boolean; onEnabledChange: (enabled: boolean) => void }) {
  return <label className="pd-control"><input type="checkbox" checked={enabled} onChange={event => onEnabledChange(event.target.checked)} /> Show part dimensions</label>;
}

function DimensionPicker({ selected, onSelect }: { selected: Dimension | 'all'; onSelect: (dimension: Dimension | 'all') => void }) {
  return <div className="pd-dimensions" role="group" aria-label="Contributor dimension">
    {(['all', ...dimensions] as const).map(dimension => <button type="button" key={dimension}
      aria-pressed={selected === dimension} onClick={() => onSelect(dimension)}>{dimension === 'all' ? 'All dimensions' : dimensionNames[dimension]}</button>)}
  </div>;
}

function useExpansion() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return { expanded, toggle };
}

/** Keep mounted across view switches to retain the viewer's step, dimension and expansion choices. */
export function PartDimensions({ enabled = false, fallback = null, graph, presentation }: {
  enabled?: boolean; fallback?: ReactNode; graph: CanonicalGraph; presentation: Presentation;
}) {
  const [stepId, selectStep] = useState(presentation.steps[0]?.id ?? '');
  const [selectedPart, selectPart] = useState<PartReference | null>(null);
  const [dimension, selectDimension] = useState<Dimension | 'all'>('all');
  const [guideLines, setGuideLines] = useState(true);
  const { expanded, toggle } = useExpansion();
  if (!enabled) return fallback;
  const step = presentation.steps.find(candidate => candidate.id === stepId) ?? presentation.steps[0];
  return <section className="part-dimensions" aria-label="Part dimensions">
    <header><div><p className="pd-eyebrow">Composition / Read-only</p><h2>Follow the demo. See its parts.</h2></div>
      <label className="pd-control"><input type="checkbox" checked={guideLines} onChange={event => setGuideLines(event.target.checked)} /> Guide lines</label></header>
    <ViewVersion version={presentation.version} />
    {!step ? <p role="status">No demo steps supplied.</p> : <>
      <SequenceView steps={presentation.steps} selected={step.id} selectedPart={selectedPart} guideLines={guideLines} onSelect={selectStep} />
      <div className="pd-step" aria-live="polite"><h3>{step.title}</h3><p>{step.description}</p></div>
      <DimensionPicker selected={dimension} onSelect={selectDimension} />
      <p className="pd-hint">Select a part to highlight its identity across dimensions and the steps that use it.</p>
      <div className="pd-trees">{dimensions.filter(value => dimension === 'all' || value === dimension).map(value =>
        <ContributionTree key={value} dimension={value} graph={graph} nodes={step.contributors[value]} selected={selectedPart}
          expanded={expanded} path={JSON.stringify([presentation.version, step.id, value])} onSelect={selectPart} onToggle={toggle} />)}</div>
    </>}
  </section>;
}
