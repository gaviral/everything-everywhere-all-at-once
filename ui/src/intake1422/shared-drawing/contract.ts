import { validDrawing, type Point, type Session } from '../../msg1351/sketch-exchange/contract';

export type { Point, Session };
export interface OperationIdentity {
  id: string;
  /** Existing D75 sketch/exchange ID, supplied by the canonical document owner. */
  exchangeId: string;
  sessionId: string;
  authorId: string;
}
export type DrawingOperation = OperationIdentity & (
  | { kind: 'stroke'; points: readonly Point[]; replaces?: string }
  | { kind: 'undo'; strokeId: string }
);
export interface StrokeEntry {
  operation: DrawingOperation;
  /** True only after acceptance by this operation's destination. */
  acknowledged: boolean;
}
export interface DrawingSnapshot {
  exchangeId: string;
  connected: boolean;
  entries: readonly StrokeEntry[];
}
/** Injected host seam: one canonical append-only document per destination session.
 * The host authenticates authorId, assigns the existing exchangeId, deduplicates
 * operation IDs, orders commits, and only acknowledges destination acceptance.
 * Pending entries belong to the submitting device; target views receive accepted
 * entries only. Reconnect reuses operation IDs. A queued send is not a receipt.
 * Disable suspends delivery/subscriptions, preserves the document and pending
 * entries, and forbids replay until explicitly enabled again.
 */
export interface DrawingSessionPort {
  readonly self: Session;
  readonly destinations: readonly Session[];
  snapshot(sessionId: string): DrawingSnapshot;
  submit(operation: DrawingOperation): void;
  subscribe(changed: () => void): () => void;
  setEnabled(enabled: boolean): void;
}
export const MAX_OPERATIONS = 128;
export const MAX_POINTS = 2048;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
export function validOperation(value: DrawingOperation): boolean {
  return [value.id, value.exchangeId, value.sessionId, value.authorId].every(validId) &&
    (value.kind === 'stroke'
      ? validDrawing([value.points]) && (value.replaces === undefined || validId(value.replaces))
      : value.kind === 'undo' && validId(value.strokeId));
}
