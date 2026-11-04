export const STORE = "e2a2o.sessionFocus.v1";
export const LIMIT = 4096;
export type Focus = { goal: string; why: string; next: string; topicId?: string };
export const empty = (): Focus => ({ goal: "", why: "", next: "" });

export function clean(value: Focus): Focus {
  return { goal: value.goal.trim(), why: value.why.trim(), next: value.next.trim(),
    ...(value.topicId ? { topicId: value.topicId } : {}) };
}

export function problem(value: Focus): string {
  if (!value.goal.trim()) return "Enter a goal.";
  if (value.goal.length > 160) return "Keep Goal to 160 characters.";
  if (value.why.length > 280) return "Keep Why to 280 characters.";
  if (value.next.length > 160) return "Keep Next step to 160 characters.";
  return "";
}

type Visit = { saved: Focus | null; draft: Focus; undo: Focus | null; kept: boolean };
// Module memory belongs to this document only. Hiding the feature unmounts its UI, without losing a denied write
// or this visit's Undo. No events, timers, storage listeners or app actions run here.
const visits = new Map<string, Visit>();
let entries: [string, Focus][] | undefined;
let readable = true;
function load() {
  if (entries) return;
  entries = [];
  try {
    const raw = sessionStorage.getItem(STORE);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || !row[1]) continue;
      const value = row[1];
      if (typeof value.goal !== "string" || typeof value.why !== "string" || typeof value.next !== "string"
        || (value.topicId !== undefined && typeof value.topicId !== "string")) continue;
      if (!problem(value)) entries.push([row[0], clean(value)]);
    }
  } catch { readable = false; }
}

export function visit(speaker: string): Visit {
  load();
  let state = visits.get(speaker);
  if (!state) {
    const saved = entries!.find(([name]) => name === speaker)?.[1] ?? null;
    state = { saved, draft: saved ? { ...saved } : empty(), undo: null, kept: readable };
    visits.set(speaker, state);
  }
  return state;
}

/** A refused size check leaves the editor and saved entry intact. A denied write keeps the new text in memory. */
export function keep(speaker: string, value: Focus | null): string {
  const state = visit(speaker);
  const next = entries!.filter(([name]) => name !== speaker);
  if (value) next.push([speaker, value]);
  const serialized = JSON.stringify(next);
  if (new TextEncoder().encode(serialized).byteLength > LIMIT) return "This tab’s focus storage is full (4 KiB). Your text is still in the editor.";
  entries = next;
  state.saved = value;
  state.draft = value ? { ...value } : empty();
  try { sessionStorage.setItem(STORE, serialized); state.kept = true; }
  catch { state.kept = false; }
  return "";
}
