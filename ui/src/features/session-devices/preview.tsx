import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DevicePanel } from "./device-panel";
import { syntheticDevices, syntheticFixture, syntheticSessions } from "./synthetic-fixture";
const fixture = syntheticFixture();
fixture.runtime.setEnabled(true);
fixture.connectAll();
function View({ index }: { index: number }) {
  const [session, selectSession] = useState("review");
  return <DevicePanel runtime={fixture.runtime} local={syntheticDevices[index]} sessionId={session} sessions={syntheticSessions} selectSession={selectSession} synthetic />;
}
function Preview() {
  const [enabled, setEnabled] = useState(true);
  function toggle() { fixture.runtime.setEnabled(!enabled); setEnabled(!enabled); }
  function replay() {
    for (const version of [3, 1, 2, 2]) fixture.emit({ kind: "document", event: { sessionId: "review", version, id: `change-${version}`, text: ["A shared", "shape", "appears."][version - 1] } });
  }
  return <main><h1>Shared session devices</h1><p>Synthetic preview · No audio, permissions, or network devices. Each panel is a separate client view.</p>
    <nav aria-label="Fixture controls"><button onClick={toggle}>{enabled ? "Switch off" : "Switch on"}</button>
      <button disabled={!enabled} onClick={fixture.connectAll}>Connect three devices</button>
      <button disabled={!enabled} onClick={() => fixture.presence(2, "disconnected")}>Disconnect Desktop</button>
      <button disabled={!enabled} onClick={replay}>Replay out-of-order changes</button>
      <button disabled={!enabled} onClick={() => fixture.advance(6000)}>Advance lease clock</button>
      <button disabled={!enabled} onClick={() => fixture.advance(21000)}>Expire presence</button></nav>
    <div className="sd-preview-grid">{syntheticDevices.map((device, index) => <View key={device.id} index={index} />)}</div>
    <p>Missing proof: host registration, real shared transport, physical devices, and local microphone confirmation.</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
