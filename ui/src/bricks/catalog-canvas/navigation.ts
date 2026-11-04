import type { BrickActions } from '../contract';
import { closeCatalog, type Feature } from './catalog';

/** Wait for the host's real navigation control, then wait for the visible destination. */
export function openFeature(feature: Feature, actions: BrickActions, failed: () => void) {
  const view = feature.kind === 'view' || feature.id === 'saved-answers';
  if (!view) { closeCatalog(); return () => {}; }
  let clicked = false;
  let stopped = false;
  const finish = () => { stopped = true; observer.disconnect(); window.clearTimeout(deadline); };
  const seek = () => {
    if (stopped) return;
    const id = CSS.escape(feature.id);
    if (clicked) {
      const shown = feature.id === 'spine' || feature.source === 'built-in'
        ? !document.querySelector(`[data-detail="${id}"]`)
        : document.querySelector<HTMLElement>(`main[data-brick="${id}"]`)?.textContent?.trim();
      if (shown) finish();
      return;
    }
    const row = document.querySelector(`[data-detail="${id}"], [data-row="${id}"]`);
    const show = Array.from(row?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(button => button.textContent?.trim() === 'Show');
    const shortcut = document.querySelector<HTMLButtonElement>(`[data-guide="view:${id}"]`);
    if (!show && !shortcut) return;
    clicked = true;
    (show ?? shortcut)?.click(); closeCatalog();
  };
  const observer = new MutationObserver(seek);
  const deadline = window.setTimeout(() => { finish(); failed(); }, 6000);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  actions.openCatalog(feature.id); seek();
  return finish;
}
