import type { CanonicalGraph, Contribution } from '../../msg1351/part-dimensions';
import { resolvePart } from '../../msg1351/part-dimensions/PartReference';

export type Lens = 'plain' | 'developer' | 'founder';
export type Explanation = Readonly<{
  plain: string;
  detail: string;
  pitch: string;
  audience: string;
  benefit: string;
  classModel?: Readonly<{ name: string; superclass: string; subclass?: string }>;
}>;
export type PartTree = Readonly<{
  graph: CanonicalGraph;
  tree: readonly Contribution[];
  /** Authored explanations by exact canonical identity; never a replacement part catalog. */
  explanations?: Readonly<Record<string, Explanation>>;
  label: string;
}>;
export type TreeRow = Readonly<{
  key: string;
  node: Contribution;
  depth: number;
  ancestors: readonly string[];
  repeated: boolean;
}>;

export function identityKey(node: Contribution) {
  return `${node.part.id}@${node.part.version}`;
}

/** Walk the supplied composition, including repeated occurrences, without following cycles. */
export function readTree(nodes: readonly Contribution[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const pending = nodes.map((node, index) => ({ node, key: String(index), ancestors: [] as string[], seen: [] as Contribution[] })).reverse();
  while (pending.length) {
    const item = pending.pop()!;
    const repeated = item.seen.includes(item.node);
    rows.push({ ...item, depth: item.ancestors.length, repeated });
    if (repeated) continue;
    const children = item.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({ node: children[index], key: `${item.key}/${index}`,
        ancestors: [...item.ancestors, item.key], seen: [...item.seen, item.node] });
    }
  }
  return rows;
}

export function nameOf(graph: CanonicalGraph, row: TreeRow) {
  return resolvePart(graph, row.node.part).part?.name ?? 'Unavailable part';
}

export function explainPart(data: PartTree, row: TreeRow): Explanation | null {
  const resolved = resolvePart(data.graph, row.node.part);
  if (!resolved.part) return null;
  const authored = data.explanations?.[identityKey(row.node)];
  if (authored) return authored;
  const children = row.repeated ? [] : row.node.children ?? [];
  const names = children.map(child => resolvePart(data.graph, child.part).part?.name ?? 'an unavailable part');
  return {
    plain: names.length ? `${resolved.part.name} brings ${names.join(', ')} together.` : `${resolved.part.name} is one piece of the larger system.`,
    detail: names.length ? 'Each smaller part has a job. Choose one to follow the composition another level down.' : 'No smaller parts were supplied for this occurrence. Its specific behavior has not been described yet.',
    pitch: `${resolved.part.name}: one focused piece of a bigger product.`,
    audience: 'Audience not supplied',
    benefit: 'Add an authored explanation to describe the benefit for this part.',
  };
}
