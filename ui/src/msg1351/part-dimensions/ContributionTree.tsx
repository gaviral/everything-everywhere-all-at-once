import type { CanonicalGraph, Contribution, Dimension, PartReference } from './contract';
import { dimensionNames } from './contract';
import { samePart } from './CrossHighlight';
import { PartIdentity } from './PartReference';

type TreeProps = {
  graph: CanonicalGraph; nodes: readonly Contribution[]; dimension: Dimension;
  selected: PartReference | null; expanded: ReadonlySet<string>; path: string;
  onSelect: (part: PartReference) => void; onToggle: (key: string) => void;
};

function ContributorNode({ node, path, ancestors, ...props }: Omit<TreeProps, 'nodes'> & {
  node: Contribution; ancestors: readonly Contribution[];
}) {
  const cycle = ancestors.includes(node);
  const children = node.children ?? [];
  const open = props.expanded.has(path);
  return <li className="pd-node" data-part-id={node.part.id} data-part-version={node.part.version}>
    <div className="pd-node-row">
      {children.length > 0 && !cycle && <button type="button" className="pd-expand"
        aria-label={`${open ? 'Collapse' : 'Expand'} ${node.part.id}`} aria-expanded={open}
        onClick={() => props.onToggle(path)}>{open ? '−' : '+'}</button>}
      <button type="button" className="pd-part" aria-pressed={samePart(node.part, props.selected)} onClick={() => props.onSelect(node.part)}>
        <PartIdentity graph={props.graph} reference={node.part} />
      </button>
    </div>
    {cycle ? <p role="status">Repeated reference; expansion stops here.</p> : open && children.length > 0 &&
      <ContributorList {...props} nodes={children} path={path} ancestors={[...ancestors, node]} />}
  </li>;
}

function ContributorList({ nodes, ancestors, ...props }: TreeProps & { ancestors: readonly Contribution[] }) {
  return <ul>{nodes.map((node, index) => <ContributorNode {...props} key={index} node={node}
    path={`${props.path}/${index}`} ancestors={ancestors} />)}</ul>;
}

export function ContributionTree(props: TreeProps) {
  return <section className="pd-tree" aria-label={`${dimensionNames[props.dimension]} contributors`}>
    <h3>{dimensionNames[props.dimension]}</h3>
    {props.nodes.length ? <ContributorList {...props} ancestors={[]} /> : <p>No contributors supplied for this dimension.</p>}
  </section>;
}
