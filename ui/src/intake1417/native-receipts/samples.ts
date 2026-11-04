import type { ReceiptOperation, ReceiptStatus } from "./ReceiptInput";

export function sampleOperation(status: ReceiptStatus): ReceiptOperation {
  const operationId = `sample-${status}`;
  return {
    operationId, provider: "apple-reminders", origin: "synthetic", status,
    reminder: { title: "Bring a sketchbook", list: "Sample plans", due: "Tomorrow at 10:00", notes: "For the practice session" },
    ...(status === "confirmed" ? { receipt: { operationId, provider: "apple-reminders" as const, source: "synthetic" as const,
      outcome: "confirmed" as const, receiptId: "sample-evidence", observedAt: "2026-11-04T20:00:00.000Z" } } : {}),
  };
}
export const sampleOperations = (["pending", "confirmed", "failed", "unknown"] as const).map(sampleOperation);
