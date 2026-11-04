import type { CSSProperties } from 'react';
import type { PartTree, TreeRow } from './tree';
import { nameOf } from './tree';

export function PartPicker({ data, rows, selected, choose }: {
  data: PartTree; rows: readonly TreeRow[]; selected: string; choose: (key: string) => void;
}) {
  return <nav className="part-lenses-picker" aria-label="Choose a part">
    <p className="part-lenses-eyebrow">The whole & its pieces</p>
    <ol className="part-lenses-tree">
      {rows.map(row => <li key={row.key} style={{ '--part-lenses-depth': Math.min(row.depth, 4) } as CSSProperties}>
        <button type="button" aria-current={selected === row.key ? 'true' : undefined} onClick={() => choose(row.key)}>
          <span className="part-lenses-node-mark" aria-hidden="true">{row.depth ? '↳' : '◉'}</span>
          <span>{nameOf(data.graph, row)}{row.repeated && <small>Repeated reference</small>}</span>
          {selected === row.key && <span aria-hidden="true">↗</span>}
        </button>
      </li>)}
    </ol>
    <p className="part-lenses-picker-note">Every part is made of smaller parts.<br />Pick one. Keep going.</p>
  </nav>;
}

export function PartBreadcrumbs({ data, rows, selected, choose }: {
  data: PartTree; rows: readonly TreeRow[]; selected: TreeRow; choose: (key: string) => void;
}) {
  const parents = selected.ancestors.map(key => rows.find(row => row.key === key)!);
  return <nav className="part-lenses-breadcrumbs" aria-label="Part ancestry">
    {parents.map(row => <span key={row.key}><button type="button" onClick={() => choose(row.key)}>{nameOf(data.graph, row)}</button><span aria-hidden="true"> / </span></span>)}
    <span aria-current="page">{nameOf(data.graph, selected)}</span>
  </nav>;
}
