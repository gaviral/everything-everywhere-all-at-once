import type { ReturnPoint, VerifiedEvidence, WalkthroughHost } from "./contract";

type Snapshot = {
  enabled: boolean;
  step: "ready" | "evidence" | "feature";
  busy: boolean;
  error: string;
  returnLabel: string;
};

/** One controller per map/participant visit, retained across panel unmounts. No persistence or network. */
export function createWalkthrough(host: WalkthroughHost, evidence: VerifiedEvidence | null) {
  let state: Snapshot = { enabled: false, step: "ready", busy: false, error: "", returnLabel: "" };
  let returnPoint: ReturnPoint | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const attempt = async (action: () => Promise<void>) => {
    if (state.busy) return;
    update({ busy: true, error: "" });
    try { await action(); }
    catch { update({ error: "The demonstration could not be reached. Try again; your return point is kept." }); }
    finally { update({ busy: false }); }
  };
  const restore = async () => {
    if (!returnPoint) return true;
    if (!await returnPoint.restore()) {
      update({ error: "Your original demonstration is unavailable. Your return point is kept; try again." });
      return false;
    }
    returnPoint = null;
    update({ step: "ready", returnLabel: "" });
    return true;
  };
  return {
    evidence,
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async setEnabled(enabled: boolean) {
      await attempt(async () => {
        if (enabled || await restore()) update({ enabled });
      });
    },
    open() {
      if (!state.enabled || state.busy || state.step !== "ready" || !evidence) return;
      try {
        returnPoint = host.captureReturnPoint();
        update({ step: "evidence", returnLabel: returnPoint.label, error: "" });
      } catch { update({ error: "A return point could not be saved. Stay here and try again." }); }
    },
    async showFeature() {
      if (!state.enabled || state.step !== "evidence" || !evidence) return;
      await attempt(async () => {
        if (await host.showFeature(evidence.feature)) update({ step: "feature" });
        else update({ error: "This feature is unavailable. You can still resume your demonstration." });
      });
    },
    explain() { if (state.enabled && !state.busy && returnPoint) update({ step: "evidence", error: "" }); },
    async resume() { await attempt(async () => { await restore(); }); },
  };
}

export type WalkthroughController = ReturnType<typeof createWalkthrough>;
