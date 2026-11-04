import { useState } from 'react';
import { SystemDiagram } from './SystemDiagram';
import { messageText, nodeName } from './topology';
import { useMessages, useReducedMotion } from './useMessages';
import './system-view.css';

function ConnectedSystem() {
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const { status, flights, history, missed } = useMessages(paused, reduced);
  const latest = history[0];
  return <div id="system-view-content">
    <div className="sv-status"><p role="status">{status}{reduced ? ' · reduced motion' : ''}</p>
      <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Resume messages' : 'Pause messages'}</button></div>
    <p className="sv-key">Read from the browser up. Dots carry real event names, grouped when busy. Dashed lines show structure only.</p>
    <SystemDiagram flights={flights} />
    <div className="sv-recent" aria-label="Recent core messages">
      <h3>Last observed{latest ? ` · ${new Date(latest.observed_at).toLocaleTimeString()}` : ''}</h3>
      {!latest ? <p>No messages observed yet. Use the map to see its real activity here.</p> :
        <ul>{latest.messages.map((message, index) => <li key={index}><strong>{nodeName(message.from)} → {nodeName(message.to)}</strong><span>{messageText(message)}</span></li>)}</ul>}
      {!!missed && <p className="sv-gap" role="status">Stream gap · {missed} events missed. Missing traffic is not animated.</p>}
    </div>
    <p className="sv-key">This observer starts no work. Event names and counts only. No replay on reconnect. Journal pulses cover confirmed core transactions; direct journal writes are not traced. Git and agent lane details remain below.</p>
  </div>;
}

export function SystemView() {
  const [enabled, setEnabled] = useState(false);
  return <section className="system-view" aria-label="Live system design">
    <div className="sv-heading"><div><p className="cc-eyebrow">SYSTEM / LIVE CONNECTIONS</p><h2>See the pieces work together.</h2></div>
      <button type="button" role="switch" aria-checked={enabled} aria-controls={enabled ? 'system-view-content' : undefined} onClick={() => setEnabled(!enabled)}>{enabled ? 'Hide system view' : 'Show system view'}</button></div>
    {enabled ? <ConnectedSystem /> : <p className="sv-key">System view is off. Turn it on to watch this core’s real messages.</p>}
  </section>;
}
