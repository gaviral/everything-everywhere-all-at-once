import type { RecoveryHost, ViewValue } from './contracts';

export class ViewCheckpoint {
  valid(value: unknown): value is ViewValue {
    if (!value || typeof value !== 'object') return false;
    const view = value as ViewValue;
    return typeof view.viewId === 'string' && view.viewId.length > 0 && view.viewId.length <= 256 &&
      !!view.camera && [view.camera.x, view.camera.y, view.camera.zoom].every(Number.isFinite) &&
      view.camera.zoom > 0;
  }

  capture(host: Pick<RecoveryHost, 'readView'>): ViewValue {
    const view = host.readView();
    if (!this.valid(view)) throw new Error('View checkpoint is invalid.');
    return { viewId: view.viewId, camera: { ...view.camera } };
  }

  restore(host: Pick<RecoveryHost, 'restoreView'>, view: ViewValue): void {
    host.restoreView({ viewId: view.viewId, camera: { ...view.camera } });
  }
}
