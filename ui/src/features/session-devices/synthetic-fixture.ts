import type { SyncCursor, TransportEvent } from "./contracts";
import { SyntheticListenerAuthority } from "./listener-lease";
import { SessionDevices } from "./session-devices";
export const syntheticDevices = [{ id: "endpoint-phone", label: "Phone" }, { id: "endpoint-tablet", label: "Tablet" }, { id: "endpoint-desktop", label: "Desktop" }];
export const syntheticSessions = [{ id: "review", label: "Design review" }, { id: "other", label: "Second session" }];
/** In-memory injected event source, never a claim of a real network or capture device. */
export function syntheticFixture() {
  let time = 1000;
  const receivers = new Set<(event: TransportEvent) => void>();
  const resumed: SyncCursor[] = [];
  const capture: { sessionId: string; deviceId: string; active: boolean }[] = [];
  const revisions = new Map<string, number>();
  const emit = (event: TransportEvent) => { for (const receive of receivers) receive(event); };
  const runtime = new SessionDevices({ subscribe(receive) { receivers.add(receive); return () => { receivers.delete(receive); }; },
    resume(cursor) { resumed.push(cursor); } }, new SyntheticListenerAuthority(), {
    changed(sessionId, deviceId, active) { capture.push({ sessionId, deviceId, active }); },
  }, () => time);
  function presence(index: number, status: "connected" | "disconnected", sessionId = "review") {
    const device = syntheticDevices[index], key = `${sessionId}/${device.id}`;
    const revision = (revisions.get(key) ?? 0) + 1;
    revisions.set(key, revision);
    emit({ kind: "presence", event: { sessionId, device, revision, status, expiresAt: time + 20000 } });
  }
  return { runtime, emit, resumed, capture, presence, subscribers: () => receivers.size,
    advance(ms: number) { if (ms < 0) throw new Error("Clock must be monotonic"); time += ms; runtime.tick(); },
    connectAll() { syntheticDevices.forEach((_, index) => presence(index, "connected")); },
  };
}
