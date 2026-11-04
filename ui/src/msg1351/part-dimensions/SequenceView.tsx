import type { DemoStep, PartReference } from './contract';
import { stepUsesPart } from './CrossHighlight';

export function SequenceView({ steps, selected, selectedPart, guideLines, onSelect }: {
  steps: readonly DemoStep[]; selected: string; selectedPart: PartReference | null;
  guideLines: boolean; onSelect: (id: string) => void;
}) {
  return <nav aria-label="Demo sequence"><ol className={`pd-sequence${guideLines ? ' pd-guides' : ''}`}>
    {steps.map((step, index) => <li key={step.id} data-connected={stepUsesPart(step, selectedPart)}>
      <button type="button" aria-current={selected === step.id ? 'step' : undefined} onClick={() => onSelect(step.id)}>
        <small>Step {index + 1}{stepUsesPart(step, selectedPart) ? ' · Uses selected part' : ''}</small>
        <strong>{step.title}</strong>
      </button>
    </li>)}
  </ol></nav>;
}
