import { BRICKS, isOn, switchBrick, useBrickRegistry, useBricksOn } from "../../bricks-core";
import { BUILT_INS, builtInOn, featureAvailable, switchBuiltIn, useBuiltInsOn, type BuiltIn } from "../../shell/features";
import { FEATURE_NAMES } from "../../shell/names";
import baseline from "./baseline-folders.json";

export const GROUPS = ["New today", "Demo candidates", "Everything else"] as const;
export type Group = typeof GROUPS[number];
export type Feature = { id: string; name: string; does: string; kind: string; source: "brick" | "built-in"; on: boolean; available: boolean; fresh: boolean };
const candidates = ["draw", "clarify", "part-dimensions", "flow-canvas", "demo-parts", "live-area", "worktree-map", "take-checklist"];
// Vite expands this at build time. The baseline is the folder list at 1af6ef13.
const folders = import.meta.glob("../*/brick.json", { eager: true, import: "default" });
const newToday = new Set(Object.keys(folders).map(path => path.split("/")[1]).filter(id => !id.startsWith("_") && !baseline.includes(id)));

export function useFeatures(): Feature[] {
  useBrickRegistry(); useBricksOn(); useBuiltInsOn();
  return [
    ...BRICKS.filter(({ info }) => info.id !== "showroom").map(({ info }): Feature => ({
      ...info, source: "brick", on: isOn(info.id), available: true, fresh: newToday.has(info.id),
    })),
    ...BUILT_INS.map((info): Feature => ({ ...info, source: "built-in", on: builtInOn(info.id),
      name: FEATURE_NAMES[info.id]?.name ?? info.id, does: FEATURE_NAMES[info.id]?.does ?? "Optional app feature.",
      available: featureAvailable(info.id), fresh: false,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export function inGroup(features: Feature[], group: Group) {
  if (group === "New today") return features.filter(feature => feature.fresh);
  if (group === "Demo candidates") return candidates.flatMap(id => features.filter(feature => feature.id === id));
  return features.filter(feature => !feature.fresh && !candidates.includes(feature.id));
}

export function setFeature(feature: Feature, value: boolean) {
  if (feature.source === "brick") switchBrick(feature.id, value);
  else switchBuiltIn(feature.id as BuiltIn["id"], value);
}

export function featureEnabled(feature: Feature) {
  return feature.source === "brick" ? isOn(feature.id) : builtInOn(feature.id as BuiltIn["id"]);
}
