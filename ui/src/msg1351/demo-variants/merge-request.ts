import type { MergeAdapter, MergeRequest, MergeResult, MergeState } from "./contracts";

function validateResult(request: MergeRequest, result: MergeResult) {
  if (!result || result.requestId !== request.requestId || !["merged", "declined"].includes(result.outcome)
    || typeof result.receipt !== "string" || !result.receipt.trim()
    || typeof result.detail !== "string" || !result.detail.trim()) {
    throw new Error("The owner returned an invalid merge result. Completion is unconfirmed.");
  }
  return Object.freeze({ ...result });
}

export async function sendMergeRequest(adapter: MergeAdapter, request: MergeRequest,
  update: (state: MergeState) => void): Promise<void> {
  update({ status: "pending", request });
  try {
    const result = validateResult(request, await adapter.request(request));
    update({ status: "result", request, result });
  } catch {
    // Adapter errors may contain private paths or credentials; keep those out of the view.
    update({ status: "error", request, message: "Merge completion is unconfirmed. Check with the owner before requesting again." });
  }
}
