/** Host-owned transport translates existing room/local or hosted events into these contracts.
 * IDs are opaque endpoint IDs, never account names or hardware identifiers. */
export type DeviceIdentity = { id: string; label: string };
export type PresenceEvent = {
  sessionId: string; device: DeviceIdentity; revision: number;
  status: "connected" | "disconnected"; expiresAt: number;
};
export type DocumentEvent = { sessionId: string; version: number; id: string; text: string };
export type TransportEvent = { kind: "presence"; event: PresenceEvent } | { kind: "document"; event: DocumentEvent };
export type SyncCursor = { schema: 1; sessionId: string; version: number };
export interface TransportAdapter {
  /** Subscribe only. Endpoint registration remains with the room owner. */
  subscribe(receive: (event: TransportEvent) => void): () => void;
  resume(cursor: SyncCursor): void;
}
export type Lease = { sessionId: string; deviceId: string; requestId: string; fence: number; expiresAt: number };
export type LocalConfirmation = { sessionId: string; deviceId: string; requestId: string; expectedFence: number };
/** The host must implement each operation atomically at one shared authority, using its
 * own clock and authenticated local-confirmation evidence. A per-client authority is unsafe. */
export interface ListenerAuthority {
  inspect(sessionId: string, now: number): { fence: number; lease: Lease | null };
  grant(confirmation: LocalConfirmation, now: number): Lease | null;
  release(sessionId: string, fence: number, now: number): void;
}
export interface CaptureStatusSink {
  /** Synthetic status only. This lane never invokes audio or permission APIs. */
  changed(sessionId: string, deviceId: string, active: boolean): void;
}
