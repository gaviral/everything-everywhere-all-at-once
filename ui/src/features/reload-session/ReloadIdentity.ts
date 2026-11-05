import type { ReloadIdentity as Identity } from './contracts';

const validPart = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;

export function validIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Identity;
  return validPart(candidate.mapId) && validPart(candidate.sessionId) && validPart(candidate.buildId);
}

export class ReloadIdentity {
  readonly selected: Readonly<Identity>;

  constructor(identity: Identity) {
    if (!validIdentity(identity)) throw new Error('Select a map, session and build before recovery.');
    this.selected = Object.freeze({ ...identity });
  }

  accepts(value: unknown): value is Identity {
    return validIdentity(value) && value.mapId === this.selected.mapId &&
      value.sessionId === this.selected.sessionId && value.buildId === this.selected.buildId;
  }

  storageKey(): string {
    return `intake1411-reload-session:v1:${JSON.stringify([
      this.selected.mapId, this.selected.sessionId, this.selected.buildId,
    ])}`;
  }
}
