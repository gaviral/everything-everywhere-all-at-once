import { useState } from "react";
import type { BrickProps } from "../contract";
import { SketchExchange, type HostAdapter, type Envelope, type Session } from "../../msg1351/sketch-exchange";
import "./example.css";

/** Two local sessions share only this mounted example; no network or device access. */
function createExampleSessions(): HostAdapter[] {
  const sessions: Session[] = [{ id: "example-tablet", label: "Sketch tablet" }, { id: "example-display", label: "Main display" }];
  const listeners = new Map<string, (message: Envelope) => void>();
  return sessions.map(self => ({
    self, targets: sessions.filter(session => session.id !== self.id),
    setEnabled: () => {},
    send: message => { listeners.get(message.to)?.(message); },
    subscribe: listener => { listeners.set(self.id, listener); return () => { listeners.delete(self.id); }; },
  }));
}
export default function SketchExample({ actions }: BrickProps) {
  const [adapters] = useState(createExampleSessions);
  const [open, setOpen] = useState(true);
return <>{!open && <button className="sketch-exchange-reopen" type="button" onClick={() => setOpen(true)}>Open Sketch exchange</button>}
<section hidden={!open} className="sketch-exchange-example" aria-label="Sketch exchange example" data-guide="sketch-exchange">
    <div><strong>Sketch exchange · two local example sessions</strong><span><button type="button" onClick={() => actions.openCatalog("sketch-exchange")}>Features</button> <button type="button" onClick={() => setOpen(false)}>Close</button></span></div>
    <p>Enable both sessions below. Draw on the tablet, select Main display, then send. The display can draw a reply. Both sessions are on this page.</p>
    <div className="sketch-exchange-example-grid">{adapters.map((adapter, index) => <SketchExchange key={adapter.self.id} adapter={adapter} role={index === 0 ? "capture" : "display"} />)}</div>
  </section></>;
}
