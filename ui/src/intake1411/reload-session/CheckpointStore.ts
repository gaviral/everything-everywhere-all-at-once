import type { Checkpoint, RecoveryHost, RecoveryStorage } from './contracts';
import { DraftCheckpoint } from './DraftCheckpoint';
import { ReloadIdentity } from './ReloadIdentity';
import { ViewCheckpoint } from './ViewCheckpoint';

/** One record keeps the draft and view from the same change together. No data is removed. */
export class CheckpointStore {
  private readonly draft = new DraftCheckpoint();
  private readonly view = new ViewCheckpoint();

  constructor(private identity: ReloadIdentity, private storage: RecoveryStorage) {}

  read(): Checkpoint | null {
    const raw = this.storage.getItem(this.identity.storageKey());
    if (!raw) return null;
    if (raw.length > 2_000_000) throw new Error('Checkpoint exceeds the recovery limit.');
    const value = JSON.parse(raw) as Partial<Checkpoint> | null;
    if (!value || value.version !== 1 || !this.identity.accepts(value.identity) ||
        !this.draft.valid(value.draft) || !this.view.valid(value.view)) {
      throw new Error('Checkpoint does not match this session.');
    }
    return value as Checkpoint;
  }

  save(host: Pick<RecoveryHost, 'readDraft' | 'readView'>): void {
    const checkpoint: Checkpoint = { version: 1, identity: { ...this.identity.selected },
      draft: this.draft.capture(host), view: this.view.capture(host) };
    this.storage.setItem(this.identity.storageKey(), JSON.stringify(checkpoint));
  }

  restore(host: Pick<RecoveryHost, 'restoreDraft' | 'restoreView'>, checkpoint: Checkpoint,
    active: () => boolean): void {
    if (active()) this.draft.restore(host, checkpoint.draft);
    if (active()) this.view.restore(host, checkpoint.view);
  }
}
