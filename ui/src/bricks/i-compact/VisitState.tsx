import type { ReactNode } from "react";
import { PluginStateContext, type PluginState } from "../contract";

// A return from the map must preserve notes even when the optional Plugins gate is off.
// In-memory only: never stores original wording on disk or sends it to another participant.
const visits = new Map<string, PluginState>();
function visitState(scope: string) {
  let store = visits.get(scope);
  if (!store) {
    const values = new Map<string, unknown>();
    store = { scope, get: <T,>(key: string) => values.get(key) as T | undefined,
      set: (key, value) => { values.set(key, value); } };
    visits.set(scope, store);
  }
  return store;
}

export function VisitState({ scope, children }: { scope: string; children: ReactNode }) {
  return <PluginStateContext.Provider value={visitState(scope)}>{children}</PluginStateContext.Provider>;
}
