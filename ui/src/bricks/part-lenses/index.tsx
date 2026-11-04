import { useMemo } from 'react';
import type { BrickProps } from '../contract';
import { usePluginState } from '../contract';
import { resolvePart } from '../../msg1351/part-dimensions/PartReference';
import { exampleTree } from './example';
import { explainPart, nameOf, readTree, type Lens, type PartTree } from './tree';
import { PartBreadcrumbs, PartPicker } from './PartPicker';
import { LensSwitch } from './LensSwitch';
import { LensContent, SourceIdentity } from './LensContent';
import style from './part-lenses.css?inline';

/** Accepts the same canonical graph and contribution tree as Part dimensions. */
export function PartLenses({ data }: { data: PartTree }) {
  const rows = useMemo(() => readTree(data.tree), [data.tree]);
  const [selectedKey, select] = usePluginState('part-lenses:selected', '0');
  const [savedLens, change] = usePluginState<Lens>('part-lenses:lens', 'plain');
  const lens = ['plain', 'developer', 'founder'].includes(savedLens) ? savedLens : 'plain';
  const selected = rows.find(row => row.key === selectedKey) ?? rows[0];
  const explanation = selected ? explainPart(data, selected) : null;

  return <section className="part-lenses" aria-label="Part lenses" data-guide="part-lenses">
    <div className="part-lenses-heading">
      <div><p className="part-lenses-eyebrow">Part lenses <span aria-hidden="true">✳</span></p>
        <h1>Make it click.</h1><p className="part-lenses-subtitle">Explore one part in language for different audiences.</p></div>
      <LensSwitch lens={lens} change={change} />
    </div>
    <p className="part-lenses-example">{data.label}</p>
    {selected ? <div className="part-lenses-workbench">
      <PartPicker data={data} rows={rows} selected={selected.key} choose={select} />
      <article className="part-lenses-paper" data-lens={lens}>
        <PartBreadcrumbs data={data} rows={rows} selected={selected} choose={select} />
        <h2>{nameOf(data.graph, selected)}</h2>
        {explanation ? <LensContent data={data} row={selected} rows={rows} explanation={explanation} lens={lens} choose={select} />
          : <p className="part-lenses-detail" role="status">{resolvePart(data.graph, selected.node.part).issue}. Choose another part to explore.</p>}
        <SourceIdentity data={data} row={selected} />
      </article>
    </div> : <p className="part-lenses-empty" role="status">No parts supplied. Add a contribution tree to explore it through three lenses.</p>}
    <p className="part-lenses-footnote">Same part. Different perspective. <span aria-hidden="true">↗</span></p>
  </section>;
}

export default function PartLensesBrick({ actions }: BrickProps) {
  return <><button className="part-lenses-back" type="button" onClick={actions.closeView}>Back to map</button><PartLenses data={exampleTree} /></>;
}

export const styles = style;
