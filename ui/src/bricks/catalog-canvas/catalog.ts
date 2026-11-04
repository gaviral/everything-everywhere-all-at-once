// This catalog intentionally reads the two host registries named in the feature brief.
import { BRICKS, isOn, switchBrick, useBrickRegistry, useBricksOn, closeCatalog } from '../../bricks-core';
import { BUILT_INS, builtInOn, featureAvailable, switchBuiltIn, useBuiltInsOn, type BuiltIn } from '../../shell/features';
import { FEATURE_NAMES } from '../../shell/names';
import { groupOf } from './groups';
export { closeCatalog };
export type Feature = { id: string; name: string; does: string; kind: string; source: 'brick' | 'built-in'; on: boolean; available: boolean };
export function useCatalog(): Feature[] {
  useBrickRegistry(); useBricksOn(); useBuiltInsOn();
  return [
    ...BRICKS.map(({ info }): Feature => ({ ...info, source: 'brick', on: isOn(info.id), available: true })),
    ...BUILT_INS.map((info): Feature => ({ ...info, source: 'built-in', on: builtInOn(info.id), available: featureAvailable(info.id),
      name: FEATURE_NAMES[info.id]?.name ?? info.id, does: FEATURE_NAMES[info.id]?.does ?? 'An optional app feature.' })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
export const featuresIn = (features: Feature[], group: string) => features.filter(feature => groupOf(feature.id) === group);
export function enableFeature(feature: Feature, enabled: boolean) {
  if (feature.source === 'brick') switchBrick(feature.id, enabled);
  else switchBuiltIn(feature.id as BuiltIn['id'], enabled);
}
export const enabledNow = (feature: Feature) => feature.source === 'brick' ? isOn(feature.id) : builtInOn(feature.id as BuiltIn['id']);
