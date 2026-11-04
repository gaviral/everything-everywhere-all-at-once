import { useSyncExternalStore } from "react";
import type { MergeState } from "./contracts";
import type { VariantSession } from "./selection";

function MergeFeedback({ merge }: { merge: MergeState }) {
  if (merge.status === "idle") return <p>No merge requested.</p>;
  return <div role="status">
    <p>Requested choice: {merge.request.variant.title}</p>
    {merge.status === "pending" && <p>Pending owner result. A merge is not yet confirmed.</p>}
    {merge.status === "error" && <p>{merge.message}</p>}
    {merge.status === "result" && <>
      <p>{merge.result.outcome === "merged" ? "Owner reports merge completed." : "Owner declined the merge."}</p>
      <p>{merge.result.detail}</p><p>Receipt: {merge.result.receipt}</p>
    </>}
    <p>Original retained: {merge.request.variant.branchId}</p>
  </div>;
}

export function MergeRequest({ session }: { session: VariantSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const blocked = !session.mergeAvailable || !state.activeId || state.merge.status === "pending" || state.merge.status === "error";
  return <section aria-label="Request owner merge">
    <h3>Ask the owner to merge</h3>
    {!session.mergeAvailable && <p>Merge unavailable: no owner adapter connected.</p>}
    <button type="button" disabled={blocked} onClick={() => { void session.requestMerge(); }}>Request merge</button>
    <MergeFeedback merge={state.merge} />
  </section>;
}
