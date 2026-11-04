import { useSyncExternalStore } from "react";
import type { DeviceIdentity, Lease } from "./contracts";
import type { InputRequest } from "./input-device-request";
import type { RosterRow } from "./session-roster";
import type { SessionSync } from "./session-sync";
import type { SessionDevices } from "./session-devices";
import "./device-panel.css";

type SessionChoiceProps = { sessionId: string; sessions: { id: string; label: string }[]; selectSession: (id: string) => void };
type Props = SessionChoiceProps & { runtime: SessionDevices; local: DeviceIdentity; synthetic?: boolean };
export function DevicePanel({ runtime, local, sessionId, sessions, selectSession, synthetic = false }: Props) {
  useSyncExternalStore(runtime.subscribe, runtime.version, runtime.version);
  const sync = runtime.sync(sessionId), enabled = runtime.enabled();
  const rows = runtime.roster.rows(sessionId, runtime.now());
  const lease = enabled ? runtime.authority.inspect(sessionId, runtime.now()).lease : null;
  return <section className="session-devices" aria-label={`${local.label} device panel`}>
    <header><span>Shared session · {local.label}</span><strong>{enabled ? "Enabled" : "Off"}</strong></header>
    <SessionChoice sessionId={sessionId} sessions={sessions} selectSession={selectSession} />
    <DeviceRoster rows={rows} local={local} enabled={enabled} request={target => runtime.request(sessionId, target, local.id)} />
    <SharedDocument sync={sync} />
    <ListenerStatus lease={lease} rows={rows} synthetic={synthetic} />
    <InputRequests runtime={runtime} requests={runtime.requests.rows(sessionId)} rows={rows} local={local} enabled={enabled} synthetic={synthetic} />
  </section>;
}
function SessionChoice({ sessionId, sessions, selectSession }: SessionChoiceProps) {
  return <label>Session <select value={sessionId} onChange={event => selectSession(event.target.value)}>
    {sessions.map(session => <option key={session.id} value={session.id}>{session.label}</option>)}
  </select></label>;
}
function DeviceRoster({ rows, local, enabled, request }: {
  rows: RosterRow[]; local: DeviceIdentity; enabled: boolean; request: (target: string) => void;
}) {
  const count = rows.filter(row => row.visibleStatus === "connected").length;
  return <><p role="status">{enabled ? `${count} connected devices` : "Device sharing is off"}</p>
    <ul aria-label="Device roster">{rows.map(row => <li key={row.device.id}>
      <span>{row.device.label}{row.device.id === local.id ? " (this device)" : ""}<small>{row.visibleStatus}</small></span>
      <button disabled={!enabled || row.visibleStatus !== "connected"} onClick={() => request(row.device.id)}>Request {row.device.label}</button>
    </li>)}</ul></>;
}
function SharedDocument({ sync }: { sync: SessionSync }) {
  return <div className="sd-document" aria-label="Shared document">
    <small>Version {sync.cursor().version}{sync.pending() ? " · Waiting for missing events" : " · Up to date"}</small>
    <p>{sync.text() || "No shared changes yet"}</p>
  </div>;
}
function ListenerStatus({ lease, rows, synthetic }: { lease: Lease | null; rows: RosterRow[]; synthetic: boolean }) {
  return <><p aria-label="Listener status">{lease ? `${synthetic ? "Synthetic listener" : "Confirmed listener"}: ${deviceLabel(rows, lease.deviceId)}` : "No listener"}</p>
    <p className="sd-note">Selecting a device requests a handoff. Confirmation must happen on that device. Stop the current listener before granting another.</p></>;
}
function InputRequests({ runtime, requests, rows, local, enabled, synthetic }: {
  runtime: SessionDevices; requests: InputRequest[]; rows: RosterRow[]; local: DeviceIdentity; enabled: boolean; synthetic: boolean;
}) {
  return <ul aria-label="Input requests">{requests.map(request => <li key={request.requestId}>
    <span>{deviceLabel(rows, request.deviceId)}: {request.state}<small>{request.reason}</small></span>
    <RequestActions runtime={runtime} requestId={request.requestId} state={request.state} local={request.deviceId === local.id} canStop={request.deviceId === local.id || request.requestedBy === local.id} deviceId={local.id} synthetic={synthetic} enabled={enabled} />
  </li>)}</ul>;
}
function deviceLabel(rows: RosterRow[], deviceId: string) { return rows.find(row => row.device.id === deviceId)?.device.label ?? "Device"; }
function RequestActions({ runtime, requestId, state, local, canStop, deviceId, synthetic, enabled }: {
  runtime: SessionDevices; requestId: string; state: string; local: boolean; canStop: boolean; deviceId: string; synthetic: boolean; enabled: boolean;
}) {
  if (!enabled || !["requested", "confirmed", "active"].includes(state) || (!local && !canStop)) return null;
  return <div className="sd-actions">
    {local && synthetic && state === "requested" && <>
      <button onClick={() => runtime.confirm(requestId, deviceId, true)}>Simulate local confirmation</button>
      <button onClick={() => runtime.confirm(requestId, deviceId, false)}>Simulate denial</button>
    </>}
    {local && synthetic && state === "confirmed" && <button onClick={() => runtime.activate(requestId)}>Grant synthetic listener</button>}
    {canStop && <button onClick={() => runtime.stop(requestId)}>Stop</button>}
  </div>;
}
