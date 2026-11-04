export type VariantId = "outline" | "cards";
export type ReviewPriority = "film-likely" | "judge" | "later";
export interface DemoStep { id: string; action: string; expected: string }
export type SuppliedProof = { kind: "missing" } | { kind: "supplied"; label: string; reference: string };
export interface Candidate {
  partId: string;
  title: string;
  meaning: string;
  steps: readonly DemoStep[];
  proof: SuppliedProof;
  priority: ReviewPriority;
  filmSelected: boolean;
  support: "supported" | "unknown";
}
export interface PartReview { chosen?: VariantId; reviewed: boolean; iterations: VariantId[] }
export interface ReviewState { activePartId?: string; parts: Record<string, PartReview> }
export interface PreferenceStore { load(): unknown; save(state: ReviewState): void }
/** Host maps its own readiness/step contract here. No source imports or external actions. */
export interface PopulatedVariantsAdapter {
  getCandidates(): readonly Candidate[];
  subscribe?(changed: () => void): () => void;
  preferences: PreferenceStore;
}
export const populatedVariantsFeature = Object.freeze({
  id: "intake1417-populated-variants",
  label: "Populated variants",
  defaultEnabled: false,
  switchable: true,
});
