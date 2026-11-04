import { useEffect, useRef, useState } from "react";
import type { DependencyAdapter, DependencySnapshot } from "./contracts";
import { DependencyInput } from "./DependencyInput";

/** Own only this visit's subscription and abort signal. Late reads cannot publish after exit. */
export function DependencySnapshotState(enabled: boolean, adapter: DependencyAdapter) {
  const [snapshot, setSnapshot] = useState<DependencySnapshot | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) return;
    let active = true, read: AbortController | undefined, unsubscribe: (() => void) | undefined;
    async function refresh() {
      if (!active) return;
      read?.abort();
      const request = new AbortController(); read = request;
      setLoading(true); setErrors([]);
      try {
        const value: unknown = await adapter.readSnapshot({ signal: request.signal });
        if (!active || request.signal.aborted) return;
        const validated = DependencyInput(value);
        if (validated.ok) { setSnapshot(validated.snapshot); setErrors([]); }
        else setErrors(validated.errors);
      } catch {
        if (active && !request.signal.aborted) setErrors(["Snapshot unavailable. Refresh to try again."]);
      } finally { if (active && !request.signal.aborted) setLoading(false); }
    }
    refreshRef.current = () => { void refresh(); };
    void refresh();
    try { unsubscribe = adapter.subscribe?.(refreshRef.current); }
    catch { setErrors(["Snapshot updates unavailable. Refresh manually to try again."]); }
    return () => { active = false; read?.abort(); unsubscribe?.(); refreshRef.current = () => {}; };
  }, [enabled, adapter]);
  return { snapshot, errors, loading, refresh: () => refreshRef.current() };
}
