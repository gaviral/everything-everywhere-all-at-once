import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SharedDrawingView, SketchSessionAdapter } from './index';
import { PreviewSessionHost } from './PreviewSessionHost';
import { TargetDisplay } from './TargetDisplay';

const sessions = [{ id: 'board-a', label: 'Explanation board' }, { id: 'board-b', label: 'Second session' }];
const host = new PreviewSessionHost(sessions);
const phone = host.port({ id: 'drawing-device', label: 'Drawing device' });
const targets = sessions.map(session => host.port(session));
// Target availability is a fixture condition. Drawing still needs explicit opt-in.
targets.forEach(port => port.setEnabled(true));
let strokeNumber = 0;
const adapter = new SketchSessionAdapter(phone, () => `mark-${String(++strokeNumber).padStart(3, '0')}`);
function PreviewNavigation() {
  const [away, setAway] = useState(false);
  return <section className="sd-device"><nav><button onClick={() => setAway(!away)}>{away ? 'Return to drawing' : 'Jump to session notes'}</button></nav>
    {away ? <article className="sd-away"><h2>Session notes</h2><p>Your selected session and original marks are kept while you are here.</p></article> : <SharedDrawingView adapter={adapter} />}
  </section>;
}
function ConnectionControls() {
  const [connected, setConnected] = useState(true);
  return <button onClick={() => { host.setConnected('board-a', !connected); setConnected(!connected); }}>{connected ? 'Disconnect explanation board' : 'Reconnect explanation board'}</button>;
}
createRoot(document.getElementById('root')!).render(<main className="sd-preview">
  <div className="sd-banner"><strong>Shared drawing · scoped preview</strong><p>Synthetic sessions in this browser only. No physical-device connection or audio capture.</p><ConnectionControls /></div>
  <div className="sd-layout"><PreviewNavigation /><aside>{targets.map(port => <TargetDisplay key={port.self.id} port={port} />)}</aside></div>
</main>);
