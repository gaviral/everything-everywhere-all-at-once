import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { MachineDemo, createMachineSession } from "./index";
import { createSyntheticAdapter, syntheticParts, syntheticProfiles, type SyntheticProfileName } from "./synthetic";
import "./preview.css";

const supplier = createSyntheticAdapter();
const session = createMachineSession(syntheticParts, supplier.adapter);

function HostExample() {
  const [choice, setChoice] = useState("Story");
  return <section className="machine-demo-host" aria-label="Host example"><h2>Host example</h2>
    <label>Host choice <select value={choice} onChange={event => setChoice(event.target.value)}><option>Story</option><option>Gallery</option></select></label>
    <p>Host choice: {choice}</p><p>The host stays mounted while readiness is inspected.</p>
  </section>;
}
function Preview() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [name, setName] = useState<SyntheticProfileName>("Mac · permission denied");
  const activity = supplier.activity();
  return <main className="machine-demo-preview"><h1>Machine readiness · synthetic preview</h1>
    <p>Injected test profiles only. This preview does not inspect your device or start a demo.</p>
    <div className="machine-demo-preview-controls">
      <label><input type="checkbox" checked={state.enabled} onChange={event => session.setEnabled(event.target.checked)} /> Machine demo availability</label>
      <label>Synthetic machine <select value={name} onChange={event => {
        const selected = event.target.value as SyntheticProfileName;
        setName(selected); supplier.supply(syntheticProfiles[selected]);
      }}>{Object.keys(syntheticProfiles).map(key => <option key={key}>{key}</option>)}</select></label>
    </div>
    <p aria-live="polite">{state.enabled ? "Readiness on" : "Readiness off"} · Supplied-fact reads: {activity.reads} · Owned subscriptions: {activity.subscriptions}</p>
    <MachineDemo session={session}><HostExample /></MachineDemo>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
