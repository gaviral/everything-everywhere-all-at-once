import { useEffect, useState } from "react";
import type { InputDevice, PenDevicesAdapter } from "./contracts";
import { DrawingSurface } from "./DrawingSurface";
import { SessionTarget } from "./SessionTarget";
import { useStrokeDelivery } from "./StrokeDelivery";
import { useAdapterSnapshot } from "./adapter-snapshot";
import { captureReadiness } from "./capture-readiness";
import { DeviceChoice } from "./DeviceChoice";
import { StrokeReceipts } from "./StrokeReceipts";
import "./pen-devices.css";

export function InputSurface({ adapter, enabled = false }: { adapter: PenDevicesAdapter; enabled?: boolean }) {
  const snapshot = useAdapterSnapshot(adapter, enabled);
  const [device, setDevice] = useState<InputDevice>("pointer");
  const [selected, setSelected] = useState("");
  const [on, setOn] = useState(false);
  useEffect(() => { if (!enabled) setOn(false); }, [enabled]);
  const { records, deliver } = useStrokeDelivery(adapter, enabled && on);
  const destination = snapshot.sessions.find(session => session.id === selected);
  const { ready, message } = captureReadiness(snapshot, device, selected, on);
  return <section className="pen-devices" aria-label="Pen and touch input">
    <header><h2>Pen and touch input</h2><p>Choose where your original marks go.</p></header>
    {!enabled ? <p role="status">Pen and touch input is off.</p> : <>
      <div className="pen-controls">
        <DeviceChoice device={device} onSelect={setDevice} />
        <SessionTarget sessions={snapshot.sessions} selected={destination ? selected : ""} onSelect={setSelected} />
        <button type="button" aria-pressed={on} onClick={() => setOn(value => !value)}>{on ? "Stop drawing" : "Start drawing"}</button>
      </div>
      <p role="status">{message}</p>
      {device === "touch" && <p>Use this surface on the selected touch device through the existing connection. Scroll outside the drawing area.</p>}
      {ready && <DrawingSurface key={`${device}:${selected}`} device={device} sessionId={selected} complete={deliver} />}
    </>}
    <StrokeReceipts records={records} sessions={snapshot.sessions} />
  </section>;
}
