export type ReceiptStatus = "pending" | "confirmed" | "failed" | "unknown";
export type ReceiptProvider = "apple-reminders";
export type ReceiptOrigin = "native" | "synthetic";

/** Display fields only. Hosts must supply approved, non-private text. */
export interface ReminderFields {
  readonly title: string;
  readonly list: string;
  readonly due: string;
  readonly notes: string;
}
export interface ExternalReceipt {
  readonly operationId: string;
  readonly provider: ReceiptProvider;
  readonly source: ReceiptOrigin;
  readonly outcome: "confirmed";
  /** Opaque evidence reference; validated but never rendered. */
  readonly receiptId: string;
  readonly observedAt: string;
}
export interface ReceiptOperation {
  readonly operationId: string;
  readonly provider: ReceiptProvider;
  readonly origin: ReceiptOrigin;
  readonly status: ReceiptStatus;
  readonly reminder: ReminderFields;
  readonly receipt?: ExternalReceipt;
}
export interface ReceiptAdapter {
  /** Observe only. Execution and permission remain with the native owner. */
  subscribe(receive: (operation: unknown) => void): () => void;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const displayText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) &&
  !/(?:\/Users\/|\/home\/|[A-Z]:\\|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/)/i.test(value);
const origin = (value: unknown): value is ReceiptOrigin => value === "native" || value === "synthetic";

function readReminder(value: unknown): ReminderFields | null {
  if (!record(value) || !displayText(value.title, 160) || !value.title.trim() ||
      !displayText(value.list, 80) || !value.list.trim() || !displayText(value.due, 100) ||
      !displayText(value.notes, 400)) return null;
  return Object.freeze({ title: value.title, list: value.list, due: value.due, notes: value.notes });
}

function readEvidence(value: unknown): ExternalReceipt | undefined {
  if (!record(value) || !token(value.operationId) || value.provider !== "apple-reminders" ||
      !origin(value.source) || value.outcome !== "confirmed" || !token(value.receiptId) ||
      typeof value.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt) ||
      !Number.isFinite(Date.parse(value.observedAt)) || new Date(value.observedAt).toISOString() !== value.observedAt) return undefined;
  return Object.freeze({ operationId: value.operationId, provider: value.provider, source: value.source,
    outcome: value.outcome, receiptId: value.receiptId, observedAt: value.observedAt });
}

/** Invalid evidence is withheld; a claimed confirmation then resolves to unknown. */
export function ReceiptInput(value: unknown): ReceiptOperation | null {
  if (!record(value) || !token(value.operationId) || value.provider !== "apple-reminders" ||
      !origin(value.origin) || typeof value.status !== "string" || !["pending", "confirmed", "failed", "unknown"].includes(value.status)) return null;
  const reminder = readReminder(value.reminder);
  if (!reminder) return null;
  return Object.freeze({ operationId: value.operationId, provider: value.provider, origin: value.origin,
    status: value.status as ReceiptStatus, reminder, receipt: readEvidence(value.receipt) });
}
