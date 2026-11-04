import type { Lease, ListenerAuthority, LocalConfirmation } from "./contracts";
export type InputState = "requested" | "confirmed" | "active" | "denied" | "stopped";
export type InputRequest = LocalConfirmation & { requestedBy: string; state: InputState; expiresAt: number; reason: string; lease: Lease | null };
/** No request or transport message is local confirmation. Only the trusted host's local
 * confirmation handler may call confirm, supplying its own endpoint ID. */
export class InputDeviceRequest {
  private serial = 0;
  private requests = new Map<string, InputRequest>();
  constructor(private readonly authority: ListenerAuthority, private readonly canUse: (sessionId: string, deviceId: string) => boolean) {}
  request(sessionId: string, deviceId: string, requestedBy: string, now: number): InputRequest {
    for (const row of this.requests.values()) {
      if (row.sessionId === sessionId && row.requestedBy === requestedBy && row.state !== "active") this.end(row, "Superseded by a new request");
    }
    const row: InputRequest = { sessionId, deviceId, requestedBy, requestId: `request-${++this.serial}`,
      expectedFence: this.authority.inspect(sessionId, now).fence, state: "requested", expiresAt: now + 10000,
      reason: "Waiting for confirmation on the requested device", lease: null };
    this.requests.set(row.requestId, row);
    return this.copy(row);
  }
  confirm(requestId: string, localDeviceId: string, allowed: boolean, now: number): boolean {
    const row = this.requests.get(requestId);
    if (!row || row.state !== "requested" || row.deviceId !== localDeviceId) return false;
    if (!this.fresh(row, now)) { this.end(row, "Request expired or device unavailable"); return false; }
    row.state = allowed ? "confirmed" : "denied";
    row.reason = allowed ? "Locally confirmed; awaiting listener authority" : "Local permission denied";
    return allowed;
  }
  activate(requestId: string, now: number): boolean {
    const row = this.requests.get(requestId);
    if (!row || row.state !== "confirmed") return false;
    if (!this.fresh(row, now)) { this.end(row, "Confirmation expired or device unavailable"); return false; }
    const lease = this.authority.grant(row, now);
    row.lease = lease;
    row.state = lease ? "active" : "denied";
    row.reason = lease ? "Listener authority granted" : "Another listener or stale claim; request a new handoff";
    return !!lease;
  }
  reconcile(now: number) {
    for (const row of this.requests.values()) {
      if (["denied", "stopped"].includes(row.state)) continue;
      const lease = this.authority.inspect(row.sessionId, now).lease;
      const valid = row.state === "active" ? lease?.fence === row.lease?.fence && this.canUse(row.sessionId, row.deviceId) : this.fresh(row, now);
      if (!valid) this.stop(row.requestId, now, "Stopped; a new local confirmation is required");
    }
  }
  stop(requestId: string, now: number, reason = "Stopped locally") {
    const row = this.requests.get(requestId);
    if (!row) return;
    if (row.lease) this.authority.release(row.sessionId, row.lease.fence, now);
    this.end(row, reason);
  }
  stopAll(now: number) { for (const row of this.requests.values()) this.stop(row.requestId, now, "Feature switched off"); }
  rows(sessionId: string) { return [...this.requests.values()].filter(row => row.sessionId === sessionId).map(row => this.copy(row)); }
  private fresh(row: InputRequest, now: number) { return now < row.expiresAt && this.canUse(row.sessionId, row.deviceId); }
  private end(row: InputRequest, reason: string) { row.state = "stopped"; row.lease = null; row.reason = reason; }
  private copy(row: InputRequest): InputRequest { return { ...row, lease: row.lease ? { ...row.lease } : null }; }
}
