import { useEffect, useState } from "react";
import type { SelectionStore } from "./contracts";

export function createDependencySelection(storage?: Pick<Storage, "getItem" | "setItem">): SelectionStore {
  let retained: string | null = null;
  const key = "intake1417-dependency-sequences.selection";
  return {
    read() { try { retained = (storage ?? localStorage).getItem(key) ?? retained; } catch { /* In-memory fallback remains usable. */ } return retained; },
    write(id) { retained = id; try { (storage ?? localStorage).setItem(key, id); } catch { /* Storage denial must not prevent inspection. */ } },
  };
}

/** A missing selected ID is retained, not silently replaced by the first refreshed row. */
export function DependencySelection(enabled: boolean, store: SelectionStore) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (enabled) setSelected(store.read()); }, [enabled, store]);
  function select(id: string) { store.write(id); setSelected(id); }
  return { selected, select };
}
