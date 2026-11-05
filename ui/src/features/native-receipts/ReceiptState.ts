import type { ReceiptOperation, ReceiptStatus } from "./ReceiptInput";

export interface ReceiptResolution {
  readonly outcome: ReceiptStatus | "synthetic-preview";
  readonly label: string;
  readonly message: string;
  readonly hasMatchingReceipt: boolean;
}

function matchingReceipt(operation: ReceiptOperation): boolean {
  const receipt = operation.receipt;
  return !!receipt && receipt.operationId === operation.operationId && receipt.provider === operation.provider &&
    receipt.source === operation.origin && receipt.outcome === "confirmed";
}

/** A status word alone never proves that a reminder was written. */
export function ReceiptState(operation: ReceiptOperation): ReceiptResolution {
  const matches = matchingReceipt(operation);
  const sample = operation.origin === "synthetic";
  const prefix = sample ? "Sample · " : "";
  const result = (outcome: ReceiptResolution["outcome"], label: string, message: string) =>
    Object.freeze({ outcome, label: prefix + label, message, hasMatchingReceipt: matches });
  if (operation.status === "pending") return result("pending", "Pending", "Waiting for a result. Completion is unconfirmed.");
  if (operation.status === "failed") return result("failed", "Failed", "The operation failed. No successful write is confirmed.");
  if (operation.status === "unknown" || !matches) return result("unknown", "Unknown", "No matching confirmation is available. Completion is unknown.");
  if (sample) return result("synthetic-preview", "Confirmed preview", "A matching sample receipt shows the confirmed state. No reminder was created.");
  return result("confirmed", "Confirmed", "The supplied native receipt confirms this operation completed.");
}
