// One storage key per thought: tabs never replace each other's saved words.
export function thoughtId(): string {
  // getRandomValues also works on plain HTTP; randomUUID requires a secure page.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let batch = 0;
export function saveWaiting(key: string, messages: string[]): void {
  const written: string[] = [];
  const at = Date.now();
  const sequence = ++batch;
  try {
    for (const [part, message] of messages.entries()) {
      const entry = `${key}.${JSON.parse(message).id}`;
      localStorage.setItem(entry, JSON.stringify({ at, batch: sequence, part, message }));
      written.push(entry);
    }
  } catch (error) {
    for (const entry of written) localStorage.removeItem(entry);
    throw error;
  }
}

export function readWaiting(key: string): string[] {
  // Upgrade the earlier shared array without deleting it until every entry is saved separately.
  const legacy = localStorage.getItem(key);
  if (legacy !== null) {
    saveWaiting(key, JSON.parse(legacy));
    localStorage.removeItem(key);
  }
  const entries: { at: number; batch?: number; part?: number; message: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const entry = localStorage.key(i);
    if (entry?.startsWith(`${key}.`)) {
      const saved = localStorage.getItem(entry);
      if (saved !== null) entries.push(JSON.parse(saved));
    }
  }
  return entries.sort((a, b) => a.at - b.at || (a.batch ?? 0) - (b.batch ?? 0) || (a.part ?? 0) - (b.part ?? 0)).map((entry) => entry.message);
}

export function receivedWaiting(key: string, id: string): void {
  localStorage.removeItem(`${key}.${id}`);
}

export type RecoveryEntry = { id: string; text: string; kind: "legacy" | "speech"; message?: string; key?: string };
export type RecoveryState = { entries: RecoveryEntry[]; storageUnavailable: boolean; onlinePending?: boolean; onlineAvailable?: boolean };
const keyPart = (value: string) => encodeURIComponent(value).replace(/\./g, "%2E");
export const waitingKey = (speaker: string, map: string) => `e2a2o.waiting.${keyPart(speaker)}.map.${keyPart(map)}`;

/** Unknown and other-map words are available only through an explicit recovery action. */
export function quarantined(speaker: string, map: string | null): RecoveryEntry[] {
  const legacyBase = `e2a2o.waiting.${speaker}`;
  const base = `e2a2o.waiting.${keyPart(speaker)}`;
  const current = map ? waitingKey(speaker, map) : null;
  const found: RecoveryEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const legacyItem = key.startsWith(`${legacyBase}.`) && /^[0-9a-f-]{36}$/i.test(key.slice(legacyBase.length + 1));
    if ((key !== legacyBase && !legacyItem && !key.startsWith(`${base}.map.`)) || (current && key.startsWith(`${current}.`))) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      const messages: string[] = Array.isArray(value) ? value : [value.message];
      messages.forEach((message, index) => {
        const parsed = JSON.parse(message);
        if (typeof parsed.text === "string") found.push({ id: `${key}:${index}`, key, message, text: parsed.text, kind: "legacy" });
      });
    } catch { /* An unreadable entry is retained, never sent. */ }
  }
  return found;
}

export function discardQuarantined(entry: RecoveryEntry): void {
  if (!entry.key) return;
  const value = JSON.parse(localStorage.getItem(entry.key) ?? "null");
  if (Array.isArray(value)) {
    const remaining = value.filter((message) => message !== entry.message);
    if (remaining.length) localStorage.setItem(entry.key, JSON.stringify(remaining));
    else localStorage.removeItem(entry.key);
  } else localStorage.removeItem(entry.key);
}
