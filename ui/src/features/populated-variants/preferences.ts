import type { PartReview, PreferenceStore, ReviewState, VariantId } from "./contracts";
export const emptyReview = (): PartReview => ({ reviewed: false, iterations: [] });
const variant = (value: unknown): value is VariantId => value === "outline" || value === "cards";
export function readReviewState(value: unknown): ReviewState {
  const state: ReviewState = { parts: Object.create(null) as Record<string, PartReview> };
  if (!value || typeof value !== "object") return state;
  const source = value as Partial<ReviewState>;
  if (typeof source.activePartId === "string") state.activePartId = source.activePartId;
  if (!source.parts || typeof source.parts !== "object") return state;
  for (const [id, row] of Object.entries(source.parts)) {
    if (!row || typeof row !== "object") continue;
    state.parts[id] = { chosen: variant(row.chosen) ? row.chosen : undefined, reviewed: row.reviewed === true,
      iterations: Array.isArray(row.iterations) ? row.iterations.filter(variant) : [] };
  }
  return state;
}
export function chooseVersion(state: ReviewState, id: string, chosen: VariantId): ReviewState {
  const prior = getReview(state, id);
  return { ...state, parts: { ...state.parts, [id]: { ...prior, chosen,
    iterations: prior.chosen === chosen ? prior.iterations : [...prior.iterations, chosen] } } };
}
/** Constructing the store does no work; storage is read only when the feature is enabled. */
export function browserPreferenceStore(key = "e2a2o.intake1417.populated-variants.review"): PreferenceStore {
  return { load: () => JSON.parse(localStorage.getItem(key) ?? "null"), save: state => localStorage.setItem(key, JSON.stringify(state)) };
}

export function getReview(state: ReviewState, id: string): PartReview {
  return Object.hasOwn(state.parts, id) ? state.parts[id] : emptyReview();
}
