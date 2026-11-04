import { useEffect, useRef } from "react";
import type { OrderedPart } from "./contracts";
import { ParallelComparison, type ScopeCollision } from "./CollisionGroups";

const statusLabel = (row: OrderedPart) => row.status === "unknown" || row.status === "cyclic" ? `${row.status} · blocked` : row.status;
interface ViewProps {
  rows: readonly OrderedPart[];
  collisions: readonly ScopeCollision[];
  selected: string | null;
  detail: boolean;
  inspect(id: string): void;
  back(): void;
}

function Prerequisites({ row, rows, inspect }: { row: OrderedPart; rows: readonly OrderedPart[]; inspect(id: string): void }) {
  return <section aria-label="Prerequisites">
    <h3>Prerequisites</h3>
    {row.part.prerequisites.length ? <ul>{row.part.prerequisites.map(id => {
      const prerequisite = rows.find(candidate => candidate.part.id === id);
      return <li key={id}>{prerequisite ? <button onClick={() => inspect(id)}>{id} — {prerequisite.part.name}</button> : <span>{id} — unknown ID</span>}</li>;
    })}</ul> : <p>None declared.</p>}
  </section>;
}

function ParallelView({ selected, rows, collisions }: { selected: OrderedPart; rows: readonly OrderedPart[]; collisions: readonly ScopeCollision[] }) {
  const comparisons = ParallelComparison(selected, rows, collisions);
  return <section className="ds-parallel" aria-label="Parallel eligibility">
    <h3>Parallel comparison for {selected.part.id}</h3>
    <p>Eligibility only. This view does not launch work or reserve files.</p>
    {comparisons.length ? <ul>{comparisons.map(pair => <li key={pair.id} data-compatible={pair.compatible}>
      <strong>{selected.part.id} + {pair.id}</strong><span>{pair.reason}</span>
    </li>)}</ul> : <p>No other parts supplied.</p>}
  </section>;
}

function PartDetail({ row, rows, collisions, inspect, back }: { row: OrderedPart; rows: readonly OrderedPart[]; collisions: readonly ScopeCollision[]; inspect(id: string): void; back(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [row.part.id]);
  return <div className="ds-detail">
    <button onClick={back}>Return to sequences</button>
    <h2 ref={heading} tabIndex={-1}>{row.part.id} — {row.part.name}</h2>
    <p className="ds-status" data-status={row.status}>{statusLabel(row)}</p>
    <p>Owner: {row.part.owner} · Evidence: {row.part.evidence}</p>
    <section aria-label="Eligibility explanation"><h3>Why {row.status}?</h3><ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>
    <Prerequisites row={row} rows={rows} inspect={inspect} />
    <section aria-label="Declared file scopes"><h3>Declared file scopes</h3>{row.part.fileScopes.length ? <ul>{row.part.fileScopes.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul> : <p>Undeclared; parallel eligibility is unknown.</p>}</section>
    <ParallelView selected={row} rows={rows} collisions={collisions} />
  </div>;
}

function SequenceList({ rows, selected, inspect }: Pick<ViewProps, "rows" | "selected" | "inspect">) {
  return <section aria-label="Prerequisite sequences" className="ds-list">{rows.map(row => <article key={row.part.id} aria-label={`Part ${row.part.id}`} data-selected={selected === row.part.id}>
    <div className="ds-row-title"><h3>{row.part.id} — {row.part.name}</h3><span className="ds-status" data-status={row.status}>{statusLabel(row)}</span></div>
    <p>{row.part.prerequisites.length ? row.part.prerequisites.map(id => `${id} → ${row.part.id}`).join(" · ") : "No prerequisites"}</p>
    <p>Owner: {row.part.owner}</p>
    <ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <button data-part-id={row.part.id} aria-pressed={selected === row.part.id} onClick={() => inspect(row.part.id)}>Inspect {row.part.id}</button>
  </article>)}</section>;
}

export function SequenceView({ rows, collisions, selected, detail, inspect, back }: ViewProps) {
  const selectedRow = rows.find(row => row.part.id === selected);
  const comparison = selectedRow ?? (!selected ? rows.find(row => row.status === "ready") : undefined);
  if (detail && selectedRow) return <PartDetail row={selectedRow} rows={rows} collisions={collisions} inspect={inspect} back={back} />;
  return <>
    <p>Ready means prerequisites are satisfied. Unknown and cyclic parts stay blocked.</p>
    <section className="ds-summary" aria-label="Dependency groups">{(["ready", "blocked", "unknown", "cyclic", "complete"] as const).map(status => <p key={status}><strong>{status}</strong><span>{rows.filter(row => row.status === status).map(row => row.part.id).join(", ") || "None"}</span></p>)}</section>
    {selected && !selectedRow && <p role="status">Selected part {selected} is absent from this snapshot. Its selection is retained.</p>}
    {!rows.length && <p>No parts supplied. There is no work to recommend.</p>}
    <SequenceList rows={rows} selected={selected} inspect={inspect} />
    <section aria-label="File collisions"><h2>File collisions</h2><p>Ownership overlap is separate from prerequisite order.</p>{collisions.length ? <ul>{collisions.map(pair => <li key={`${pair.left}:${pair.right}`}><strong>{pair.left} + {pair.right}</strong>: {pair.scopes.join(", ")}. No parallel recommendation.</li>)}</ul> : <p>No overlapping declared scopes.</p>}</section>
    {comparison && <ParallelView selected={comparison} rows={rows} collisions={collisions} />}
  </>;
}
