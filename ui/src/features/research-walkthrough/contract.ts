export type LocalAsset = {
  /** A bundled asset URL supplied by an import; never a remote image or private file. */
  src: string;
  alt: string;
  permission: string;
};

export type VerifiedEvidence = {
  id: string;
  title: string;
  claim: string;
  sourceTitle: string;
  sourceUrl: string;
  citation: string;
  verifiedOn: string;
  support: string;
  limitation: string;
  connection: string;
  feature: string;
  asset: LocalAsset | null;
};

export type ReturnPoint = {
  label: string;
  /** Restore the same map/participant visit, view, selection, filter, viewport and focus.
   * Resolve false if that visit no longer exists. Never silently restore a different map. */
  restore: () => Promise<boolean>;
};

export type WalkthroughHost = {
  /** Capture once on Open. Keep the controller outside mount-scoped action wrappers. */
  captureReturnPoint: () => ReturnPoint;
  /** Explicit navigation only. Resolve after the feature is visible; never start listening. */
  showFeature: (feature: string) => Promise<boolean>;
};
