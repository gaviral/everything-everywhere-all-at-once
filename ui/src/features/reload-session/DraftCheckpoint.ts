import type { DraftValue, RecoveryHost } from './contracts';

export class DraftCheckpoint {
  valid(value: unknown): value is DraftValue {
    if (!value || typeof value !== 'object') return false;
    const draft = value as DraftValue;
    return typeof draft.text === 'string' && draft.text.length <= 1_000_000 &&
      Number.isInteger(draft.selectionStart) && Number.isInteger(draft.selectionEnd) &&
      draft.selectionStart >= 0 && draft.selectionEnd >= draft.selectionStart &&
      draft.selectionEnd <= draft.text.length &&
      ['forward', 'backward', 'none'].includes(draft.selectionDirection);
  }

  capture(host: Pick<RecoveryHost, 'readDraft'>): DraftValue {
    const draft = host.readDraft();
    if (!this.valid(draft)) throw new Error('Draft checkpoint is invalid.');
    return { ...draft };
  }

  restore(host: Pick<RecoveryHost, 'restoreDraft'>, draft: DraftValue): void {
    host.restoreDraft({ ...draft });
  }
}
