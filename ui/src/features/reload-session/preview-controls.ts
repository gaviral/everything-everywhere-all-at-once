import { previewElement } from './preview-layout';
import { PreviewDriver } from './preview-driver';
import { writePreviewPreference } from './preview-storage';

export function bindPreviewControls(root: HTMLElement, driver: PreviewDriver,
  setEnabled: (enabled: boolean) => void, signal: AbortSignal): void {
  const click = (id: string, action: () => void) => previewElement(root, id).addEventListener('click', action, { signal });
  const toggle = previewElement<HTMLInputElement>(root, 'recovery-enabled');
  toggle.addEventListener('change', () => {
    const persisted = writePreviewPreference(toggle.checked);
    setEnabled(toggle.checked);
    if (!persisted) previewElement(root, 'checkpoint-status').textContent = 'Switch preference could not be saved in this browser.';
  }, { signal });
  click('reload-page', () => location.reload());
  click('disconnect', () => driver.signal('disconnected'));
  click('connect', () => driver.signal('connected'));
  click('matching-snapshot', () => driver.snapshot());
  click('build-start', () => driver.signal('build-start'));
  click('build-fail', () => driver.fail());
  click('build-recover', () => driver.snapshot());
  click('emit-snapshot', () => driver.snapshot(previewElement<HTMLSelectElement>(root, 'snapshot-identity').value));
  click('switch-session', () => {
    const url = new URL(location.href);
    url.searchParams.set('session', previewElement<HTMLSelectElement>(root, 'open-session').value);
    location.assign(url);
  });
}
