import type { Lens } from './tree';

const lenses: readonly { id: Lens; label: string; number: string }[] = [
  { id: 'plain', label: 'Plain language', number: '01' },
  { id: 'developer', label: 'Developer', number: '02' },
  { id: 'founder', label: 'Founder', number: '03' },
];

export function LensSwitch({ lens, change }: { lens: Lens; change: (lens: Lens) => void }) {
  return <div className="part-lenses-switch" role="group" aria-label="Explanation lens">
    {lenses.map(item => <button key={item.id} type="button" aria-pressed={lens === item.id} onClick={() => change(item.id)}>
      <small aria-hidden="true">{item.number}</small>{item.label}
    </button>)}
  </div>;
}
