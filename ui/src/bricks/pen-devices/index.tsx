import { useState, useSyncExternalStore } from "react";
import { InputSurface } from "../../features/pen-devices/InputSurface";
import { StrokeMarks } from "../../features/pen-devices/DrawingSurface";
import { PreviewAdapter } from "../../features/pen-devices/preview-adapter";
function Destination({ adapter }: { adapter: PreviewAdapter }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return <div className="pen-devices-example-grid">{snapshot.sessions.map(session => <section key={session.id}><h2>{session.name}</h2><p>{snapshot.received.filter(stroke => stroke.sessionId === session.id).length} strokes received</p><div className="pen-devices" aria-label={`${session.name} received marks`}><StrokeMarks strokes={snapshot.received.filter(stroke => stroke.sessionId === session.id)} /></div></section>)}</div>;
}
import type { BrickProps } from "../contract";
import "./example.css";

export default function Example({ actions }: BrickProps) {
const [adapter] = useState(() => new PreviewAdapter());
const [open, setOpen] = useState(true);
return <>{!open && <button className="pen-devices-reopen" type="button" onClick={() => setOpen(true)}>Open Pen and touch</button>}
<section hidden={!open} className="pen-devices-example" aria-label="Pen and touch example" data-guide="pen-devices">
<div><strong>Pen and touch · local example</strong><span><button type="button" onClick={() => actions.openCatalog("pen-devices")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
<p>Choose a destination, press Start drawing, then draw in the surface. Both destinations are local examples.</p><InputSurface enabled adapter={adapter} /><Destination adapter={adapter} />
</section></>;
}
