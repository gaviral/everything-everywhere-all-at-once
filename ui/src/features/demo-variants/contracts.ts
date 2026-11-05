export interface VariantFeature {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** IDs and feature manifests come from the owner. This feature never edits a reference. */
export interface VariantReference {
  readonly id: string;
  readonly title: string;
  readonly branchId: string;
  readonly canvasId: string;
  readonly features: readonly VariantFeature[];
}

export interface MergeRequest {
  readonly requestId: string;
  readonly variant: VariantReference;
}

export interface MergeResult {
  readonly requestId: string;
  readonly outcome: "merged" | "declined";
  readonly receipt: string;
  readonly detail: string;
}

/** Only the existing owner executes a merge. Resolution must carry its actual result. */
export interface MergeAdapter {
  request(request: MergeRequest): Promise<MergeResult>;
}

export type MergeState =
  | { readonly status: "idle" }
  | { readonly status: "pending"; readonly request: MergeRequest }
  | { readonly status: "result"; readonly request: MergeRequest; readonly result: MergeResult }
  | { readonly status: "error"; readonly request: MergeRequest; readonly message: string };

export interface VariantState {
  readonly enabled: boolean;
  readonly selectedId: string | null;
  readonly activeId: string | null;
  readonly comparison: Readonly<{ leftId: string | null; rightId: string | null }>;
  readonly merge: MergeState;
}
