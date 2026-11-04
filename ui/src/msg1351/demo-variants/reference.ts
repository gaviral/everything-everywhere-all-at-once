import type { VariantReference } from "./contracts";

function requireText(value: string, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
}

function snapshotReference(reference: VariantReference): VariantReference {
  for (const field of ["id", "title", "branchId", "canvasId"] as const) requireText(reference[field], field);
  const seen = new Set<string>();
  const features = reference.features.map(feature => {
    for (const field of ["id", "label", "description"] as const) requireText(feature[field], field);
    if (seen.has(feature.id)) throw new Error("Feature IDs must be unique within a choice.");
    seen.add(feature.id);
    return Object.freeze({ ...feature });
  });
  return Object.freeze({ ...reference, features: Object.freeze(features) });
}

export function preserveReferences(input: readonly VariantReference[]): readonly VariantReference[] {
  const seen = new Set<string>();
  const references = input.map(reference => {
    if (seen.has(reference.id)) throw new Error("Choice IDs must be unique.");
    seen.add(reference.id);
    return snapshotReference(reference);
  });
  return Object.freeze(references);
}
