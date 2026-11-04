import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { LiveAreaAdapters, RunIdentity } from "./contracts";
import { activityKey } from "./contracts";
import { LiveAreaStore } from "./LiveAreaStore";
import type { LiveAreaSnapshot } from "./LiveAreaStore";
import { ActivityRow } from "./ActivityRow";
import { SelectedStatus } from "./SelectedStatus";
import "./live-area.css";

export type LiveAreaProps = { adapters: LiveAreaAdapters; enabled?: boolean; onEnabledChange?: (enabled: boolean) => void; selected?: RunIdentity };

function SourceSummary({ sources }: { sources: LiveAreaSnapshot["sources"] }) {
  return <p className="la-sources" role="status">Activity: {sources.activity.state} · Reload: {sources.build.state} · Version: {sources.version.state}</p>;
}

function ActivityRows({ snapshot, selected }: { snapshot: LiveAreaSnapshot; selected?: RunIdentity }) {
  if (!snapshot.rows.length) return <p>No activity received. A permitted external feed is required.</p>;
  return <ul className="la-rows">{snapshot.rows.map(row => <ActivityRow key={activityKey(row.activity.event)} row={row} sources={snapshot.sources} selected={selected} />)}</ul>;
}

function useLiveArea(adapters: LiveAreaAdapters, enabled: boolean) {
  // Adapters should be stable host objects; changing them replaces the consumer safely.
  const store = useMemo(() => new LiveAreaStore(adapters), [adapters]);
  useEffect(() => { store.setEnabled(enabled); return () => store.setEnabled(false); }, [store, enabled]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** The host controls the feature switch; default is off even without a host catalog. */
export function LiveArea({ adapters, enabled = false, onEnabledChange, selected }: LiveAreaProps) {
  const snapshot = useLiveArea(adapters, enabled);
  return <section className="intake1411-live-area" aria-label="Live development area">
    <header className="la-header"><div><h2>Development activity</h2><p>Activity, build and version in one place.</p></div>
      <button type="button" role="switch" aria-checked={enabled} onClick={() => onEnabledChange?.(!enabled)} disabled={!onEnabledChange}>
        {enabled ? "Turn live area off" : "Turn live area on"}</button></header>
    {enabled && snapshot.enabled ? <><SourceSummary sources={snapshot.sources} /><SelectedStatus snapshot={snapshot} selected={selected} /><ActivityRows snapshot={snapshot} selected={selected} /></>
      : <p>Live area is off. No subscriptions. Retained records are kept.</p>}
  </section>;
}
