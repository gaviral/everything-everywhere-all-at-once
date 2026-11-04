import type { VariantFeature, VariantReference } from "./contracts";

export interface FeatureDifference {
  readonly id: string;
  readonly left?: VariantFeature;
  readonly right?: VariantFeature;
  readonly difference: "shared" | "changed" | "left-only" | "right-only";
}

/** Compares supplied manifests only; this is not a source-code diff. */
export function compareVariants(left: VariantReference, right: VariantReference): FeatureDifference[] {
  const a = new Map(left.features.map(feature => [feature.id, feature]));
  const b = new Map(right.features.map(feature => [feature.id, feature]));
  return [...new Set([...a.keys(), ...b.keys()])].map(id => {
    const l = a.get(id), r = b.get(id);
    const difference = !l ? "right-only" : !r ? "left-only"
      : l.label === r.label && l.description === r.description ? "shared" : "changed";
    return { id, left: l, right: r, difference };
  });
}
