import type { RecoveryStorage } from './contracts';

const metricsKey = 'intake1411-reload-preview:activity';
export const preferenceKey = 'intake1411-reload-preview:enabled';

export class PreviewStorage implements RecoveryStorage {
  private counts = { writes: 0, draftRestores: 0, viewRestores: 0 };

  constructor(private output: HTMLElement) {
    try { Object.assign(this.counts, JSON.parse(sessionStorage.getItem(metricsKey) || '{}')); } catch { /* Fresh metrics. */ }
    this.render();
  }

  getItem(key: string): string | null { return sessionStorage.getItem(key); }

  setItem(key: string, value: string): void {
    sessionStorage.setItem(key, value);
    this.counts.writes++;
    this.record();
  }

  restored(part: 'draft' | 'view'): void {
    if (part === 'draft') this.counts.draftRestores++;
    else this.counts.viewRestores++;
    this.record();
  }

  private record(): void {
    try { sessionStorage.setItem(metricsKey, JSON.stringify(this.counts)); } catch { /* Metrics are optional. */ }
    this.render();
  }

  private render(): void {
    this.output.textContent = `${this.counts.writes} checkpoint writes · ${this.counts.draftRestores} draft restores · ${this.counts.viewRestores} view restores`;
  }
}

export function readPreviewPreference(): boolean {
  try { return sessionStorage.getItem(preferenceKey) === 'true'; } catch { return false; }
}

export function writePreviewPreference(enabled: boolean): boolean {
  try { sessionStorage.setItem(preferenceKey, String(enabled)); return true; } catch { return false; }
}
