import { resolvePart } from '../../msg1351/part-dimensions/PartReference';
import type { Explanation, Lens, PartTree, TreeRow } from './tree';
import { nameOf } from './tree';

type ContentProps = { data: PartTree; row: TreeRow; rows: readonly TreeRow[]; explanation: Explanation; choose: (key: string) => void };

function Composition({ data, row, rows, choose, diagram = false }: Omit<ContentProps, 'explanation'> & { diagram?: boolean }) {
  const children = rows.filter(candidate => candidate.ancestors.at(-1) === row.key);
  return <section className={`part-lenses-composition${diagram ? ' part-lenses-composition-diagram' : ''}`} aria-label="Smaller parts">
    <p className="part-lenses-eyebrow">{diagram ? '◆ Composition · has these parts' : 'Made of smaller parts'}</p>
    {children.length ? <div className="part-lenses-pieces">{children.map(child => <button type="button" key={child.key} onClick={() => choose(child.key)}>
      <span>{nameOf(data.graph, child)}</span><span aria-hidden="true">↗</span>
    </button>)}</div> : <p className="part-lenses-leaf">{row.repeated ? 'Repeated reference. This branch stops here.' : 'No smaller parts supplied in this tree.'}</p>}
  </section>;
}

function PlainLens(props: ContentProps) {
  return <div className="part-lenses-plain">
    <p className="part-lenses-eyebrow">In everyday words</p>
    <h3 className="part-lenses-big-line">{props.explanation.plain}</h3>
    <p className="part-lenses-detail">{props.explanation.detail}</p>
    <Composition {...props} />
  </div>;
}

function ClassBox({ label, name, selected = false }: { label: string; name: string; selected?: boolean }) {
  return <div className={`part-lenses-class${selected ? ' part-lenses-class-selected' : ''}`}>
    <span className="part-lenses-eyebrow">{label}</span><strong>{name}</strong>
  </div>;
}

function InheritanceArrow() {
  return <div className="part-lenses-inheritance"><span aria-hidden="true">△<br />│</span><small>is a kind of</small></div>;
}

function DeveloperLens(props: ContentProps) {
  const model = props.explanation.classModel;
  return <div className="part-lenses-developer">
    <p className="part-lenses-model-note">Illustrative class model · composition follows the supplied tree</p>
    {model ? <div className="part-lenses-inheritance-chain" aria-label="Class inheritance">
      <ClassBox label="Superclass" name={model.superclass} />
      <InheritanceArrow />
      <ClassBox label="Class · this part" name={model.name} selected />
      {model.subclass && <><InheritanceArrow /><ClassBox label="Example subclass" name={model.subclass} /></>}
    </div> : <p className="part-lenses-detail">No class or subclass model supplied for this part. Composition alone does not imply inheritance.</p>}
    <Composition {...props} diagram />
  </div>;
}

function FounderLens({ explanation }: ContentProps) {
  return <div className="part-lenses-founder">
    <p className="part-lenses-eyebrow">The one-line pitch</p>
    <span className="part-lenses-quote" aria-hidden="true">“</span>
    <h3 className="part-lenses-big-line">{explanation.pitch}</h3>
    <div className="part-lenses-value"><div><p className="part-lenses-eyebrow">For whom</p><p>{explanation.audience}</p></div>
      <div><p className="part-lenses-eyebrow">Why it matters</p><p>{explanation.benefit}</p></div></div>
  </div>;
}

export function LensContent({ lens, ...props }: ContentProps & { lens: Lens }) {
  if (lens === 'developer') return <DeveloperLens {...props} />;
  if (lens === 'founder') return <FounderLens {...props} />;
  return <PlainLens {...props} />;
}

export function SourceIdentity({ data, row }: { data: PartTree; row: TreeRow }) {
  const result = resolvePart(data.graph, row.node.part);
  return <details className="part-lenses-source"><summary>Part reference · v{row.node.part.version}</summary>
    <p>{row.node.part.id}</p>
    <p>{result.part ? `${result.part.file}:${result.part.line} · ${result.part.version_scope}` : result.issue}</p>
  </details>;
}
