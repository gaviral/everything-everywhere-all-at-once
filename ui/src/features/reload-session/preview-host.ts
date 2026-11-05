import type { DraftValue, RecoveryHost, ViewValue } from './contracts';
import type { PreviewSnapshot } from './preview-driver';
import { previewElement } from './preview-layout';
import { PreviewStorage } from './preview-storage';

export class PreviewHost implements RecoveryHost<PreviewSnapshot> {
  private view: ViewValue = { viewId: 'map', camera: { x: 0, y: 0, zoom: 1 } };
  private changes = new Set<() => void>();
  private draft: HTMLTextAreaElement;
  private viewSelect: HTMLSelectElement;

  constructor(private root: HTMLElement, private storage: PreviewStorage) {
    this.draft = previewElement(root, 'unsent-draft');
    this.viewSelect = previewElement(root, 'selected-view');
    this.renderView();
  }

  readDraft(): DraftValue {
    return { text: this.draft.value, selectionStart: this.draft.selectionStart,
      selectionEnd: this.draft.selectionEnd, selectionDirection: this.draft.selectionDirection };
  }

  readView(): ViewValue { return { viewId: this.view.viewId, camera: { ...this.view.camera } }; }

  restoreDraft(draft: DraftValue): void {
    this.draft.value = draft.text;
    this.draft.setSelectionRange(draft.selectionStart, draft.selectionEnd, draft.selectionDirection);
    this.storage.restored('draft');
    this.renderSelection();
  }

  restoreView(view: ViewValue): void {
    this.view = { viewId: view.viewId, camera: { ...view.camera } };
    this.viewSelect.value = view.viewId;
    this.storage.restored('view');
    this.renderView();
  }

  applySnapshot(snapshot: PreviewSnapshot, revision: string): void {
    if (snapshot.label !== 'Sample garden') throw new Error('Unknown synthetic snapshot.');
    previewElement(this.root, 'revision-readout').textContent = revision;
  }

  subscribeChanges(listener: () => void): () => void {
    this.changes.add(listener);
    return () => { this.changes.delete(listener); };
  }

  bind(signal: AbortSignal): void {
    for (const type of ['input', 'select', 'keyup', 'pointerup', 'selectionchange']) {
      this.draft.addEventListener(type, () => this.draftChanged(), { signal });
    }
    this.viewSelect.addEventListener('change', () => {
      this.view.viewId = this.viewSelect.value;
      this.viewChanged();
    }, { signal });
    previewElement(this.root, 'pan-left').addEventListener('click', () => this.pan(-40), { signal });
    previewElement(this.root, 'pan-right').addEventListener('click', () => this.pan(40), { signal });
    previewElement(this.root, 'zoom-in').addEventListener('click', () => {
      this.view.camera.zoom = Math.min(3, this.view.camera.zoom + 0.25);
      this.viewChanged();
    }, { signal });
  }

  private pan(delta: number): void { this.view.camera.x += delta; this.viewChanged(); }

  private draftChanged(): void { this.renderSelection(); this.notify(); }

  private viewChanged(): void { this.renderView(); this.notify(); }

  private notify(): void { for (const listener of this.changes) listener(); }

  private renderSelection(): void {
    previewElement(this.root, 'selection-readout').textContent = `Selection ${this.draft.selectionStart}–${this.draft.selectionEnd}`;
  }

  private renderView(): void {
    const { viewId, camera } = this.view;
    const scene = previewElement(this.root, 'preview-scene');
    scene.dataset.view = viewId;
    const content = previewElement(this.root, 'scene-content');
    content.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    previewElement(this.root, 'view-readout').textContent = `${viewId} · camera ${camera.x}, ${camera.y} · ${camera.zoom}×`;
  }
}
