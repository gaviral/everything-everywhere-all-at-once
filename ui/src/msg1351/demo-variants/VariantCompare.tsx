import { useSyncExternalStore } from "react";
import { compareVariants } from "./compare";
import type { VariantReference } from "./contracts";
import type { VariantSession } from "./selection";

function ComparePicker({ label, value, excluded, references, onChange }: {
  label: string; value: string; excluded: string; references: readonly VariantReference[]; onChange(id: string): void;
}) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>
    {references.map(reference => <option key={reference.id} value={reference.id} disabled={reference.id === excluded}>{reference.title}</option>)}
  </select></label>;
}

function Comparison({ left, right }: { left: VariantReference; right: VariantReference }) {
  const rows = compareVariants(left, right);
  return <div className="demo-variants-differences">
    <h3>{left.title} compared with {right.title}</h3>
    <p>Supplied feature lists. Source comparison unavailable: no compare adapter connected.</p>
    {rows.length === 0 && <p>No features supplied for these choices.</p>}
    <ul>{rows.map(row => <li key={row.id}>
      <strong>{row.left?.label ?? row.right?.label}</strong>
      {row.difference === "shared" ? <p>Both: {row.left!.description}</p> : <>
        <p>{left.title}: {row.left ? `${row.left.label} — ${row.left.description}` : "Not included"}</p>
        <p>{right.title}: {row.right ? `${row.right.label} — ${row.right.description}` : "Not included"}</p>
      </>}
    </li>)}</ul>
  </div>;
}

export function VariantCompare({ session }: { session: VariantSession }) {
  const { comparison: { leftId, rightId } } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const references = session.references;
  const left = references.find(reference => reference.id === leftId);
  const right = references.find(reference => reference.id === rightId);
  if (references.length < 2 || !left || !right) return <p>Provide two choices to compare.</p>;
  return <section aria-label="Compare choices">
    <div className="demo-variants-pickers">
      <ComparePicker label="First choice" value={left.id} excluded={right.id} references={references} onChange={id => session.compare("leftId", id)} />
      <ComparePicker label="Second choice" value={right.id} excluded={left.id} references={references} onChange={id => session.compare("rightId", id)} />
    </div>
    <Comparison left={left} right={right} />
  </section>;
}
