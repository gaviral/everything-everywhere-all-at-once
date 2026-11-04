import type { PresenceEvent } from "./contracts";
export type RosterRow = PresenceEvent & { visibleStatus: "connected" | "disconnected" | "stale" };
export class SessionRoster {
  private sessions = new Map<string, Map<string, PresenceEvent>>();
  receive(event: PresenceEvent) {
    if (!Number.isSafeInteger(event.revision) || event.revision < 1 || !Number.isFinite(event.expiresAt)) return;
    const rows = this.sessions.get(event.sessionId) ?? new Map<string, PresenceEvent>();
    if ((rows.get(event.device.id)?.revision ?? 0) >= event.revision) return;
    rows.set(event.device.id, { ...event, device: { ...event.device } });
    this.sessions.set(event.sessionId, rows);
  }
  rows(sessionId: string, now: number): RosterRow[] {
    return [...(this.sessions.get(sessionId)?.values() ?? [])].map(row => ({ ...row, device: { ...row.device },
      visibleStatus: row.status === "disconnected" ? "disconnected" : row.expiresAt <= now ? "stale" : "connected",
    }));
  }
  connected(sessionId: string, deviceId: string, now: number) {
    return this.rows(sessionId, now).some(row => row.device.id === deviceId && row.visibleStatus === "connected");
  }
  count(sessionId: string, now: number) { return this.rows(sessionId, now).filter(row => row.visibleStatus === "connected").length; }
}
