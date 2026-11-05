import type { DeviceIdentity } from "./contracts";
export interface IdentityStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** Inject profile storage and an opaque random ID source; no browser globals at import time. */
export function deviceIdentity(storage: IdentityStorage, randomId: () => string, label: string): DeviceIdentity {
  const key = "intake1422.session-devices.endpoint";
  let id = storage.getItem(key);
  if (!id) { id = randomId(); storage.setItem(key, id); }
  return { id, label: label.trim() || "Unnamed device" };
}
