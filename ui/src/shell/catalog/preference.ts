import { useSyncExternalStore } from "react";

const KEY = "e2a2o.catalog-organization";
export function readOrganization(value: string | null): boolean {
  try { return JSON.parse(value ?? "false") === true; } catch { return false; }
}
function read() { try { return readOrganization(localStorage.getItem(KEY)); } catch { return false; } }
let enabled = typeof window !== "undefined" && read();
const watchers = new Set<() => void>();
const changed = () => { for (const watcher of watchers) watcher(); };
export function setOrganization(value: boolean) {
  enabled = value;
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* This visit still works. */ }
  changed();
}
export const useOrganization = () => useSyncExternalStore(
  (watcher) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; },
  () => enabled, () => false,
);
if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) { enabled = read(); changed(); }
});

export function ordinaryCatalogRoute(search: string, pathname: string): boolean {
  const params = new URLSearchParams(search);
  return !["film", "recording", "demo", "remote", "cards"].some((key) => params.has(key))
    && params.get("shell") !== "1" && !pathname.endsWith("/bricks.html");
}

export type CatalogSession = { query: string; detail: string | null; task: string | null; scroll: number; focus: string | null; backScroll: number; backFocus: string; homeScroll: number };
export const newCatalogSession = (): CatalogSession => ({ query: "", detail: null, task: null, scroll: 0, focus: null, backScroll: 0, backFocus: "search", homeScroll: 0 });
