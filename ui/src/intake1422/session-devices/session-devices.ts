import type { CaptureStatusSink, ListenerAuthority, TransportAdapter, TransportEvent } from "./contracts";
import { InputDeviceRequest } from "./input-device-request";
import { SessionRoster } from "./session-roster";
import { SessionSync } from "./session-sync";
import { TransportSubscription } from "./transport-adapter";

/** One injected runtime per authority scope, shared by the synthetic views. The host
 * supplies trusted presence events, a monotonic clock and periodic tick even offscreen. */
export class SessionDevices {
  readonly roster = new SessionRoster();
  readonly requests: InputDeviceRequest;
  private syncs = new Map<string, SessionSync>();
  private transport: TransportSubscription;
  private active = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private on = false;
  constructor(transport: TransportAdapter, readonly authority: ListenerAuthority,
    private readonly capture: CaptureStatusSink, private readonly clock: () => number) {
    this.requests = new InputDeviceRequest(authority, (session, device) => this.on && this.roster.connected(session, device, this.clock()));
    this.transport = new TransportSubscription(transport, event => this.receive(event));
  }
  enabled = () => this.on;
  version = () => this.revision;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  now = () => this.clock();
  setEnabled(enabled: boolean) {
    if (this.on === enabled) return;
    this.on = enabled;
    if (enabled) this.transport.start(this.syncs.values());
    else { this.transport.stop(); this.requests.stopAll(this.clock()); }
    this.tick();
  }
  sync(sessionId: string) {
    let sync = this.syncs.get(sessionId);
    if (!sync) { sync = new SessionSync(sessionId); this.syncs.set(sessionId, sync); if (this.on) this.transport.resume(sync); }
    return sync;
  }
  request(sessionId: string, deviceId: string, requestedBy: string) {
    if (!this.on || !this.roster.connected(sessionId, deviceId, this.clock()) || !this.roster.connected(sessionId, requestedBy, this.clock())) return null;
    this.sync(sessionId);
    const request = this.requests.request(sessionId, deviceId, requestedBy, this.clock());
    this.tick(); return request;
  }
  confirm(requestId: string, localDeviceId: string, allowed: boolean) {
    if (!this.on) return false;
    const confirmed = this.requests.confirm(requestId, localDeviceId, allowed, this.clock());
    this.tick(); return confirmed;
  }
  activate(requestId: string) {
    if (!this.on) return false;
    const granted = this.requests.activate(requestId, this.clock());
    this.tick(); return granted;
  }
  stop(requestId: string) { this.requests.stop(requestId, this.clock()); this.tick(); }
  tick = () => {
    this.requests.reconcile(this.clock());
    this.publishCaptureStatus();
    this.revision++;
    for (const listener of this.listeners) listener();
  };
  private receive(event: TransportEvent) {
    if (!this.on) return;
    if (event.kind === "presence") this.roster.receive(event.event);
    else this.sync(event.event.sessionId).receive(event.event);
    this.tick();
  }
  private publishCaptureStatus() {
    const next = new Map<string, string>();
    if (this.on) for (const sessionId of this.syncs.keys()) {
      const lease = this.authority.inspect(sessionId, this.clock()).lease;
      if (lease && this.requests.rows(sessionId).some(row => row.state === "active" && row.lease?.fence === lease.fence)) next.set(sessionId, lease.deviceId);
    }
    for (const [session, device] of this.active) if (next.get(session) !== device) this.capture.changed(session, device, false);
    for (const [session, device] of next) if (this.active.get(session) !== device) this.capture.changed(session, device, true);
    this.active = next;
  }
}
