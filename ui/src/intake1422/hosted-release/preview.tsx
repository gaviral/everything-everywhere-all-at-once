import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HostedCandidateView } from './HostedCandidateView';
import { artifactIdentity } from './candidate-identity';
import { syntheticCandidates } from './fixtures';
import { hostedReleaseFeature } from './feature';
import './preview.css';

const fixtures = await syntheticCandidates();

function Preview() {
  const [enabled, setEnabled] = useState<boolean>(hostedReleaseFeature.defaultEnabled);
  const [direction, setDirection] = useState('forward');
  const [tampered, setTampered] = useState(false);
  const [stale, setStale] = useState(false);
  const prior = direction === 'forward' ? fixtures.prior : fixtures.candidate;
  const candidate = direction === 'forward' ? fixtures.candidate : fixtures.prior;
  return <main className="hosted-release-preview"><h1>Candidate rehearsal</h1><p>Two synthetic revisions. No live service, credentials or microphone.</p>
    <fieldset><legend>Local preview controls</legend>
      <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enable hosted candidate inspection</label>
      <label>Candidate direction <select value={direction} onChange={event => setDirection(event.target.value)}><option value="forward">Revision 2 after revision 1</option><option value="reverse">Revision 1 after revision 2</option></select></label>
      <label><input type="checkbox" checked={tampered} onChange={event => setTampered(event.target.checked)} /> Try a mismatched fingerprint</label>
      <label><input type="checkbox" checked={stale} onChange={event => setStale(event.target.checked)} /> Try a stale current identity</label>
    </fieldset>
    {!enabled && <p role="status">Hosted candidate inspection is off. Preview selections are retained.</p>}
    <HostedCandidateView enabled={enabled} candidate={tampered ? { ...candidate, fingerprint: `sha256:${'0'.repeat(64)}` } : candidate}
      prior={prior} expectedCurrent={artifactIdentity(stale ? candidate : prior)} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
