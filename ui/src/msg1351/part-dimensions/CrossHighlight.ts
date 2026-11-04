import type { Contribution, DemoStep, PartReference } from './contract';
import { dimensions } from './contract';

export function samePart(a: PartReference, b: PartReference | null) {
  return !!b && a.id === b.id && a.version === b.version;
}

function containsPart(nodes: readonly Contribution[], reference: PartReference, visited = new Set<Contribution>()): boolean {
  return nodes.some(node => {
    if (visited.has(node)) return false;
    visited.add(node);
    return samePart(node.part, reference) || containsPart(node.children ?? [], reference, visited);
  });
}

export function stepUsesPart(step: DemoStep, reference: PartReference | null) {
  return !!reference && dimensions.some(dimension => containsPart(step.contributors[dimension], reference));
}
