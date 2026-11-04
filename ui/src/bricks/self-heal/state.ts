import { useSyncExternalStore } from "react";
import type { BrickInfo } from "../contract";

const KEY = "e2a2o.self-heal";
const LIMIT = 20;
type Stopped = { name: string };
export type Incident = { id: string; name: string; at: string; error: string };
type Recovery = { stopped: Record<string, Stopped>; log: Incident[] };
const empty = (): Recovery => ({ stopped: {}, log: [] });
function read(): Recovery {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!value || !value.stopped || typeof value.stopped !== "object" || Array.isArray(value.stopped) || !Array.isArray(value.log)) return empty();
    const stopped = Object.fromEntries(Object.entries(value.stopped).filter(([id, entry]) => /^[a-z][a-z0-9-]*$/.test(id) && typeof (entry as Stopped)?.name === "string").map(([id, entry]) => [id, { name: (entry as Stopped).name }]));
    const log = value.log.filter((row: Incident) => row && [row.id, row.name, row.at, row.error].every(field => typeof field === "string")).slice(-LIMIT);
    return { stopped, log };
  } catch { return empty(); }
}
let recovery = read();
const watchers = new Set<() => void>();
const dismissed = new Set<string>();
const changed = () => { for (const watch of watchers) watch(); };
export const watchRecovery = (watch: () => void) => { watchers.add(watch); return () => { watchers.delete(watch); }; };
export const isStopped = (id: string) => Object.hasOwn(recovery.stopped, id);
export const noticeDismissed = (id: string) => dismissed.has(id);
export const useRecovery = () => useSyncExternalStore(watchRecovery, () => recovery, () => recovery);
function save(next: Recovery) {
  recovery = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep recovery working when storage is unavailable. */ }
  changed();
}
export function recordCrash(info: BrickInfo, error: unknown) {
  console.error(`The ${info.name} feature stopped:`, error);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  dismissed.delete(info.id);
  save({ stopped: { ...recovery.stopped, [info.id]: { name: info.name } },
    log: [...recovery.log, { id: info.id, name: info.name, at: new Date().toISOString(), error: message.slice(0, 500) }].slice(-LIMIT) });
}
export function clearStopped(id: string) {
  if (!isStopped(id)) return;
  const stopped = { ...recovery.stopped };
  delete stopped[id];
  dismissed.delete(id);
  save({ ...recovery, stopped });
}
export function dismissNotice(id: string) {
  dismissed.add(id);
  recovery = { ...recovery };
  changed();
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === KEY || event.key === null) { recovery = read(); changed(); }
});
