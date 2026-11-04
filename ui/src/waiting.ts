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
