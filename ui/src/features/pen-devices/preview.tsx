import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { InputSurface } from "./InputSurface";
import { StrokeMarks } from "./DrawingSurface";
import { PreviewAdapter } from "./preview-adapter";
import "./preview.css";

const adapter = new PreviewAdapter();

function DestinationPreviews() {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return <div className="pen-preview-destinations">{snapshot.sessions.map(session => {
    const strokes = snapshot.received.filter(stroke => stroke.sessionId === session.id);
    return <section key={session.id} className="pen-devices" data-destination={session.id}>
      <h2>{session.name}</h2><p>{session.connected ? "Connected" : "Disconnected"} · {strokes.length} strokes received</p>
      <div className="pen-preview-marks"><StrokeMarks strokes={strokes} /></div>
      <ul>{strokes.map(stroke => <li key={stroke.id}><code>{stroke.id}</code> · {stroke.points.length} original samples</li>)}</ul>
    </section>;
  })}</div>;
}

function SyntheticControls() {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return <fieldset className="pen-preview-fixture"><legend>Synthetic adapter controls</legend>
    {snapshot.sessions.map(session => <button key={session.id} onClick={() => adapter.toggleConnection(session.id)}>
      {session.connected ? "Disconnect" : "Reconnect"} {session.name}</button>)}
    <label><input type="checkbox" onChange={event => { adapter.hold = event.target.checked; }} />Hold acknowledgments</label>
    <button onClick={adapter.release}>Release held acknowledgments</button>
    <label><input type="checkbox" onChange={event => { adapter.mismatch = event.target.checked; }} />Simulate mismatched receipt</label>
  </fieldset>;
}

function Preview() {
  const [enabled, setEnabled] = useState(false);
  return <main className="pen-preview">
    <h1>Pen and touch input preview</h1>
    <p>Synthetic sessions and acknowledgments. No hardware or network transport proof.</p>
    <button className="pen-preview-switch" aria-pressed={enabled} onClick={() => setEnabled(value => !value)}>
      {enabled ? "Disable pen-devices feature" : "Enable pen-devices feature"}</button>
    <InputSurface enabled={enabled} adapter={adapter} />
    <SyntheticControls /><DestinationPreviews />
  </main>;
}

// Read-only fixture observations for checks; the drawing events still pass through the rendered surface.
Object.defineProperty(window, "penDevicesObservation", { get: () => adapter.getSnapshot() });
Object.defineProperty(window, "penDevicesSubscriberCount", { get: () => adapter.subscriberCount });
createRoot(document.getElementById("root")!).render(<Preview />);
