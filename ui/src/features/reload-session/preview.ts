import './preview.css';
import { createReloadSession, describeReloadState } from './index';
import { bindPreviewControls } from './preview-controls';
import { PreviewDriver } from './preview-driver';
import { PreviewHost } from './preview-host';
import { previewElement, renderPreviewLayout } from './preview-layout';
import { PreviewStorage, readPreviewPreference } from './preview-storage';

function mountPreview(root: HTMLElement): () => void {
  renderPreviewLayout(root);
  const session = new URL(location.href).searchParams.get('session') === 'other' ? 'other' : 'sample';
  const identity = { mapId: 'sample-garden', sessionId: session, buildId: 'sample-build' };
  const storage = new PreviewStorage(previewElement(root, 'recovery-metrics'));
  const driver = new PreviewDriver(identity);
  const host = new PreviewHost(root, storage);
  const recovery = createReloadSession({ identity, storage, source: driver, host });
  const events = new AbortController();
  host.bind(events.signal);
  previewElement<HTMLSelectElement>(root, 'open-session').value = session;
  const unsubscribe = recovery.state.subscribe(state => {
    previewElement<HTMLInputElement>(root, 'recovery-enabled').checked = state.enabled;
    const status = previewElement(root, 'recovery-status');
    status.textContent = describeReloadState(state);
    status.dataset.phase = state.enabled ? state.phase : 'off';
    previewElement(root, 'checkpoint-status').textContent = {
      none: 'No checkpoint written in this visit.', saved: 'Draft and place saved on this device.',
      restored: 'Draft, selection and place restored.', unavailable: 'Checkpoint unavailable; keep this page open to retain your work.',
    }[state.checkpoint];
  });
  bindPreviewControls(root, driver, recovery.setEnabled, events.signal);
  recovery.setEnabled(readPreviewPreference());
  return () => { events.abort(); recovery.dispose(); unsubscribe(); };
}

const root = document.getElementById('reload-preview');
if (root) {
  const dispose = mountPreview(root);
  window.addEventListener('pagehide', dispose, { once: true });
}
