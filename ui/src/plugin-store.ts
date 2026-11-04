// Trusted local prepared files, never sent to the core.
import type { BrickInfo } from "./bricks/contract";
export type Package = { info: BrickInfo; js: string; css: string; revision: string };
const memory = new Map<string, Package>();
export let visitOnly = false;
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("e2a2o.plugins.v1", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("packages")) request.result.createObjectStore("packages", { keyPath: "info.id" });
      if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function packages(): Promise<Package[]> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["packages", "state"]);
      const values = tx.objectStore("state").openCursor();
      values.onsuccess = () => { const cursor = values.result; if (cursor) { if (!states.has(String(cursor.key))) states.set(String(cursor.key), cursor.value); cursor.continue(); } };
      const request = tx.objectStore("packages").getAll();
      let result: Package[] = [];
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => { db.close(); resolve(result); };
    });
  } catch { visitOnly = true; return [...memory.values()]; }
}
export async function keepPackage(value: Package) {
  memory.set(value.info.id, value);
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("packages", "readwrite");
      tx.objectStore("packages").put(value);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch { visitOnly = true; }
}
const states = new Map<string, unknown>();
const encode = (_key: string, value: unknown) => value instanceof Set ? { $set: [...value] } : value instanceof Map ? { $map: [...value] } : value;
const decode = (_key: string, value: any) => value?.$set ? new Set(value.$set) : value?.$map ? new Map(value.$map) : value;
const stores = new Map<string, ReturnType<typeof makeState>>();
export function savedState(scope: string) {
  let store = stores.get(scope);
  if (!store) { store = makeState(scope); stores.set(scope, store); }
  return store;
}
function makeState(scope: string) {
  const prefix = `e2a2o.plugin-state:${scope}:`;
  const watchers = new Set<() => void>();
  return {
    scope,
    subscribe(watcher: () => void) { watchers.add(watcher); return () => { watchers.delete(watcher); }; },
    get<T>(key: string): T | undefined {
      if (states.has(prefix + key)) return states.get(prefix + key) as T;
      try { const raw = localStorage.getItem(prefix + key); if (raw !== null) { const value = JSON.parse(raw, decode); states.set(prefix + key, value); return value; } } catch { visitOnly = true; }
      return undefined;
    },
    set<T>(key: string, value: T) {
      states.set(prefix + key, value);
      for (const watcher of watchers) watcher();
      void database().then(db => {
        const tx = db.transaction("state", "readwrite"); tx.objectStore("state").put(value, prefix + key);
        tx.oncomplete = () => db.close(); tx.onerror = () => { visitOnly = true; db.close(); };
      }).catch(() => { visitOnly = true; });
      try { localStorage.setItem(prefix + key, JSON.stringify(value, encode)); } catch { visitOnly = true; }
    },
  };
}
