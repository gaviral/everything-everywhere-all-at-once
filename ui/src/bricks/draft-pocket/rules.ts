export const STORE = "e2a2o.draftPocket.v1";
export const MAX_ENTRIES = 8;
export const MAX_CHARACTERS = 2000;
export const MAX_BYTES = 40 * 1024;

export type Draft = { id: string; text: string; saved: number; submitted: boolean };
type Pocket = { entries: Draft[]; input: string; editing: string | null };
type Stored = { version: 1; people: Record<string, Draft[]>; inputs?: Record<string, string> };
// Loaded only when enabled. No socket or app-state access. This cache also keeps
// words over a feature hide/show when the browser refuses sessionStorage.
let stored: Stored | undefined;
let storageWarning = "";
let inputWarning = "";
const pockets = new Map<string, Pocket>();
const bytes = (text: string) => new TextEncoder().encode(text).length;

function load(): Stored {
  if (stored) return stored;
  stored = { version: 1, people: Object.create(null) };
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) {
      if (bytes(raw) > MAX_BYTES) throw new Error("oversized pocket");
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !parsed.people || typeof parsed.people !== "object" || Array.isArray(parsed.people)) throw new Error("invalid pocket");
      for (const [person, entries] of Object.entries(parsed.people)) {
        if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || entries.some(d =>
          !d || typeof d.id !== "string" || typeof d.text !== "string" || d.text.length > MAX_CHARACTERS ||
          !Number.isFinite(d.saved) || Math.abs(d.saved) > 8.64e15 || typeof d.submitted !== "boolean") ||
          new Set(entries.map(d => d.id)).size !== entries.length) throw new Error("invalid drafts");
        stored.people[person] = entries.map(d => ({ id: d.id, text: d.text, saved: d.saved, submitted: d.submitted }));
      }
      if (parsed.inputs !== undefined) {
        if (!parsed.inputs || typeof parsed.inputs !== "object" || Array.isArray(parsed.inputs) ||
          Object.values(parsed.inputs).some(text => typeof text !== "string")) throw new Error("invalid input backup");
        stored.inputs = Object.assign(Object.create(null), parsed.inputs);
      }
    }
  } catch {
    storageWarning = "Tab storage is unavailable or unreadable. Words stay in memory; reload may lose changes.";
  }
  return stored;
}

export function pocketFor(person: string): Pocket {
  const data = load();
  let pocket = pockets.get(person);
  if (!pocket) {
    pocket = { entries: Object.hasOwn(data.people, person) ? data.people[person] : [], input: "", editing: null };
    pockets.set(person, pocket);
  }
  return pocket;
}

export function warning() { return [storageWarning, inputWarning].filter(Boolean).join(" "); }

function write(data: Stored) {
  stored = data;
  try {
    sessionStorage.setItem(STORE, JSON.stringify(data));
    storageWarning = "";
  } catch {
    storageWarning = "Tab storage is unavailable. Words and submission status stay in memory; reload may lose changes.";
  }
}

// Separate from the eight pocket entries: this never submits, clears or parks the main input.
// Consume once on mount, so hiding/reopening the feature cannot resurrect an older input.
export function takeInput(person: string): string | undefined {
  const data = load();
  const text = Object.hasOwn(data.inputs ?? {}, person) ? data.inputs![person] : undefined;
  if (text !== undefined) keepInput(person, "");
  return text;
}

export function keepInput(person: string, text: string) {
  const data = load();
  const inputs: Record<string, string> = Object.assign(Object.create(null), data.inputs);
  delete inputs[person];
  if (text) inputs[person] = text;
  const next: Stored = { ...data, inputs };
  if (!Object.keys(inputs).length) delete next.inputs;
  if (bytes(JSON.stringify(next)) > MAX_BYTES) {
    // Do not leave an older backup that could replace the current words after reload.
    delete inputs[person];
    if (!Object.keys(inputs).length) delete next.inputs;
    inputWarning = "The input box cannot fit in this tab's 40 KiB reload backup. Keep a copy before reloading. Nothing was cut.";
  } else inputWarning = "";
  write(next);
}

export function textError(text: string): string {
  if (!text.trim()) return "Write something before saving.";
  if (text.length > MAX_CHARACTERS) return "Keep each draft within 2,000 characters. Nothing was cut.";
  return "";
}

/** Refuse capacity changes before touching memory or storage; a denied store keeps the complete value in memory. */
export function keep(person: string, entries: Draft[], submission = false): string {
  if (entries.length > MAX_ENTRIES) return "Eight drafts is the limit. Delete one before saving another.";
  const data = load();
  const next: Stored = { ...data, people: { ...data.people, [person]: entries } };
  const serialized = JSON.stringify(next);
  if (bytes(serialized) > MAX_BYTES && !submission) return "This tab's pocket reached 40 KiB. Nothing was overwritten.";
  pocketFor(person).entries = entries;
  stored = next;
  try {
    if (bytes(serialized) > MAX_BYTES) throw new Error("full");
    sessionStorage.setItem(STORE, serialized);
    storageWarning = "";
  } catch {
    storageWarning = "Tab storage is unavailable. Words and submission status stay in memory; reload may lose changes.";
  }
  return "";
}
