import type { Session } from './contract';
export function TargetSession({ targets, selected, onSelect, disabled }: {
  targets: readonly Session[]; selected: string; onSelect: (id: string) => void; disabled: boolean;
}) {
  return <label className="sketch-target">Destination display<select value={selected} disabled={disabled} onChange={e => onSelect(e.target.value)}>
    <option value="">Choose a display…</option>{targets.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
  </select></label>;
}
