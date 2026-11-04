import { useCallback, useRef, useSyncExternalStore } from "react";
import type { InputSnapshot, PenDevicesAdapter } from "./contracts";

const EMPTY: InputSnapshot = Object.freeze({ sessions: [], touchAvailable: false });

/** No polling or subscription while off. Last names remain available for retained receipts. */
export function useAdapterSnapshot(adapter: PenDevicesAdapter, enabled: boolean) {
  const last = useRef<InputSnapshot>(EMPTY);
  const subscribe = useCallback((listener: () => void) => enabled ? adapter.subscribe(listener) : () => {}, [adapter, enabled]);
  const getSnapshot = useCallback(() => {
    if (enabled) last.current = adapter.getSnapshot();
    return last.current;
  }, [adapter, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
