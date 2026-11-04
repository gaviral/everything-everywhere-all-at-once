import { useMemo, type ReactNode } from "react";
import { PluginStateContext, type PluginState } from "../contract";

const visits = new Map<string, PluginState>();

function visitState(scope: string): PluginState {
  const found = visits.get(scope);
  if (found) return found;
  const values = new Map<string, unknown>();
  const state: PluginState = { scope, get: <T,>(key: string) => values.get(key) as T | undefined,
    set: <T,>(key: string, value: T) => { values.set(key, value); } };
  visits.set(scope, state);
  return state;
}

/** View changes retain this visit's choices even with the optional Plugins feature off. */
export function ReadingVisit({ scope, children }: { scope: string; children: ReactNode }) {
  const state = useMemo(() => visitState(scope), [scope]);
  return <PluginStateContext.Provider value={state}>{children}</PluginStateContext.Provider>;
}
