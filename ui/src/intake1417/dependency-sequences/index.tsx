import { useMemo, useRef, useState } from "react";
import type { DependencyAdapter, SelectionStore } from "./contracts";
import { DependencySnapshotState } from "./DependencySnapshotState";
import { createDependencySelection, DependencySelection } from "./DependencySelection";
import { DependencyOrder } from "./DependencyOrder";
import { CollisionGroups } from "./CollisionGroups";
import { SequenceView } from "./SequenceView";
import "./styles.css";

export type { DependencyAdapter, DependencyPart, DependencySnapshot, SelectionStore } from "./contracts";
export interface DependencySequencesProps {
  adapter: DependencyAdapter;
  enabled?: boolean;
  selection?: SelectionStore;
  /** Host turns the switch off and restores its return destination. */
  onDisable(): void;
}

export function DependencySequences({ adapter, enabled = false, selection, onDisable }: DependencySequencesProps) {
  const [fallbackSelection] = useState(createDependencySelection);
  const { selected, select } = DependencySelection(enabled, selection ?? fallbackSelection);
  const { snapshot, errors, loading, refresh } = DependencySnapshotState(enabled, adapter);
  const [detail, setDetail] = useState(false);
  const root = useRef<HTMLElement>(null);
  const model = useMemo(() => snapshot ? { ...DependencyOrder(snapshot), collisions: CollisionGroups(snapshot.parts) } : null, [snapshot]);
  function inspect(id: string) { select(id); setDetail(true); }
  function back() {
    setDetail(false);
    requestAnimationFrame(() => Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-part-id]") ?? []).find(button => button.dataset.partId === selected)?.focus());
  }
  if (!enabled) return null;
  return <section className="dependency-sequences" ref={root} aria-label="Dependency sequences">
    <header><div><p className="ds-eyebrow">Parts / prerequisites</p><h1>Dependency sequences</h1><p>Inspect what comes first and what can run together.</p></div><button onClick={onDisable}>Turn off and return</button></header>
    <div className="ds-toolbar"><button onClick={refresh}>Refresh snapshot</button><p role="status">{loading ? "Reading snapshot… Eligibility is unavailable during refresh." : errors.length ? "Snapshot not verified. Eligibility is unavailable." : snapshot ? `Snapshot ${snapshot.revision}` : "Waiting for a snapshot."}</p></div>
    {errors.length > 0 && <div role="alert"><h2>Cannot verify dependencies</h2><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul><p>Your part selection is retained.</p></div>}
    {!loading && !errors.length && model && <SequenceView rows={model.rows} collisions={model.collisions} selected={selected} detail={detail} inspect={inspect} back={back} />}
  </section>;
}

/** Isolated host contract; shared catalog and switch wiring belong to the host owner. */
export const dependencySequencesFeature = Object.freeze({
  id: "intake1417-dependency-sequences",
  name: "Dependency sequences",
  defaultEnabled: false,
  Component: DependencySequences,
  createSelection: createDependencySelection,
});
