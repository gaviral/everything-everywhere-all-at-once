import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BrickProps } from "../contract";
import type { MemoryKind, MemoryRecord, MemorySource, ProjectMemoryProps } from "./contract";
import { publicExample } from "./contract";
import { filterRecords, indexRecords, type MemoryIndex } from "./index-records";
import { countStates, revisionState, stateLabels } from "./revision";
import css from "./project-memory.css?inline";

const kinds: readonly { id: MemoryKind | "all"; label: string }[] = [
  { id: "all", label: "Everything" }, { id: "decision", label: "Decisions" },
  { id: "part", label: "Parts" }, { id: "ask", label: "Open asks" }, { id: "revision", label: "Revisions" },
];
const kindLabels: Record<MemoryKind, string> = { decision: "Decision", part: "Part", ask: "Open ask", revision: "Revision" };
const kindMarks: Record<MemoryKind, string> = { decision: "◆", part: "◈", ask: "?", revision: "↗" };

function MemoryIntroduction({ index }: { index: MemoryIndex }) {
  const counts = countStates(index.records);
  return <div className="project-memory-intro">
    <div>
      <p className="project-memory-eyebrow">Project memory <span>Read only</span></p>
      <h1>Pick up where<br />you left off.</h1>
      <p className="project-memory-deck">The choices, pieces and open questions.<br />Together, for the next whole-project revision.</p>
      <p className="project-memory-privacy">{index.example ? "Synthetic public example · " : "Supplied public records · "}{index.title}<br />Private records stay outside this index.</p>
    </div>
    <div className="project-memory-orbit" aria-label={`${counts.current} current records, ${counts.unresolved} unresolved records, ${counts.superseded} superseded records`}>
      <span className="project-memory-orbit-line" aria-hidden="true" />
      <div className="project-memory-token project-memory-token-current"><span>Keep the direction</span><strong>{counts.current}</strong><small>current records</small></div>
      <div className="project-memory-token project-memory-token-open"><span>Leave room to ask</span><strong>{counts.unresolved}</strong><small>unresolved records</small></div>
      <div className="project-memory-token project-memory-token-past"><span>Keep the reasons</span><strong>{counts.superseded}</strong><small>superseded record{counts.superseded === 1 ? "" : "s"}</small></div>
    </div>
  </div>;
}

function ReceiptNotice() {
  return <aside className="project-memory-receipt" aria-label="Canvas receipt status">
    <span className="project-memory-receipt-mark" aria-hidden="true">?</span>
    <div><strong>Canvas lane: recover the original receipt first.</strong><p>Brief reference: Inbox Wed 14:0x. The receipt was not supplied; the DAG names no owner. No replacement is assigned here.</p></div>
    <span className="project-memory-receipt-tag">Owner unverified</span>
  </aside>;
}

function MemoryEntry({ record, index, selected, choose }: { record: MemoryRecord; index: MemoryIndex; selected: boolean; choose: (id: string) => void }) {
  const state = revisionState(record, index.records).state;
  return <button type="button" className={`project-memory-entry project-memory-entry-${record.kind}`} aria-pressed={selected} onClick={() => choose(record.id)}>
    <span className="project-memory-kind-mark" aria-hidden="true">{kindMarks[record.kind]}</span>
    <span className="project-memory-entry-words"><span className="project-memory-entry-meta">{kindLabels[record.kind]} <span className={`project-memory-state project-memory-state-${state}`}>{stateLabels[state]}</span></span><strong>{record.title}</strong></span>
    <span className="project-memory-entry-arrow" aria-hidden="true">↗</span>
  </button>;
}

function SourceExcerpt({ source, anchor, initiallyOpen }: { source: MemorySource; anchor: string; initiallyOpen: boolean }) {
  return <details className="project-memory-source" id={anchor} open={initiallyOpen}>
    <summary>{source.title}<span>{source.locator}</span></summary>
    <blockquote>{source.excerpt}</blockquote>
  </details>;
}

function RecordRelationship({ label, record, choose }: { label: string; record?: MemoryRecord; choose: (id: string) => void }) {
  return record ? <div className="project-memory-relationship"><span>{label}</span><button type="button" onClick={() => choose(record.id)}>{record.title} <span aria-hidden="true">↗</span></button></div> : null;
}

function RecordDetail({ record, index, choose, prefix, headingRef }: { record: MemoryRecord; index: MemoryIndex; choose: (id: string) => void; prefix: string; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const revision = revisionState(record, index.records);
  const sources = index.sources.filter(source => record.sourceIds.includes(source.id));
  const related = index.records.filter(item => record.relatedIds?.includes(item.id));
  const openSource = (id: string) => {
    const source = document.getElementById(`${prefix}-${id}`) as HTMLDetailsElement | null;
    if (source) { source.open = true; source.querySelector("summary")?.focus(); source.scrollIntoView({ block: "nearest", behavior: "instant" }); }
  };
  return <article className="project-memory-detail" aria-label="Selected memory">
    <div className="project-memory-detail-meta"><span>{kindLabels[record.kind]}</span><span className={`project-memory-state project-memory-state-${revision.state}`}>{stateLabels[revision.state]}</span></div>
    <h2 ref={headingRef} tabIndex={-1}>{record.title}</h2>
    <p className="project-memory-summary">{record.summary}</p>
    {record.ownership && <p className="project-memory-owner">{record.ownership.status === "receipt-needed" ? "Owner unassigned · original receipt needed" : `Owner confirmed in supplied record · ${record.ownership.name}`}</p>}
    <RecordRelationship label="Replaces" record={revision.previous} choose={choose} />
    <RecordRelationship label="Superseded by" record={revision.replacement} choose={choose} />
    <section className="project-memory-evidence" aria-label="Source evidence">
      <h3>Follow the source <span>{sources.length}</span></h3>
      <p className="project-memory-source-links">{sources.map(source => <a key={source.id} href={`#${prefix}-${source.id}`} onClick={event => { event.preventDefault(); openSource(source.id); }}>{source.title} ↗</a>)}</p>
      {sources.map((source, position) => <SourceExcerpt key={`${record.id}-${source.id}`} source={source} anchor={`${prefix}-${source.id}`} initiallyOpen={position === 0} />)}
    </section>
    {related.length > 0 && <section className="project-memory-related" aria-label="Connected records"><h3>Connected to this</h3>{related.map(item => <button key={item.id} type="button" onClick={() => choose(item.id)}><span>{kindLabels[item.kind]}</span>{item.title} <b aria-hidden="true">↗</b></button>)}</section>}
    <p className="project-memory-footnote">{index.example ? "Example excerpts, not original Inbox receipts." : "Only explicitly supplied public sources are shown."} Reading here changes no project records.</p>
  </article>;
}

export default function ProjectMemory({ memory = publicExample, actions }: ProjectMemoryProps & Partial<Pick<BrickProps, "actions">>) {
  const index = useMemo(() => indexRecords(memory), [memory]);
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  const [query, setQuery] = useState("");
  const [includeSuperseded, setIncludeSuperseded] = useState(true);
  const [selected, setSelected] = useState("useful-opening");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusOnCommit = useRef(false);
  const prefix = `project-memory-${useId()}`;
  const records = useMemo(() => filterRecords(index, { kind, query, includeSuperseded }), [index, kind, query, includeSuperseded]);
  const active = records.find(record => record.id === selected) ?? records[0];
  const focusDetail = () => { headingRef.current?.focus(); headingRef.current?.scrollIntoView({ block: "nearest" }); };
  useLayoutEffect(() => {
    if (focusOnCommit.current) { focusOnCommit.current = false; focusDetail(); }
  });
  const selectRecord = (id: string) => {
    if (active?.id === id) focusDetail();
    else focusOnCommit.current = true;
    setSelected(id);
  };
  const choose = (id: string) => {
    selectRecord(id);
    // A relationship jump reveals its destination even across filters or superseded history.
    setKind("all"); setQuery(""); setIncludeSuperseded(true);
  };
  return <section className="project-memory" aria-label="Project memory" data-guide="project-memory">
    {actions && <button className="project-memory-back" type="button" onClick={actions.closeView}>Back to map</button>}
    <MemoryIntroduction index={index} />
    {memory === publicExample && <ReceiptNotice />}
    <div className="project-memory-workspace">
      <section className="project-memory-index" aria-label="Memory index">
        <div className="project-memory-index-heading"><h2>The project, in context</h2><span aria-live="polite">{records.length} records</span></div>
        <label className="project-memory-search"><span>Find a record or source</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try “opening” or “receipt”" /></label>
        <div className="project-memory-filters" role="group" aria-label="Record type">{kinds.map(item => <button type="button" key={item.id} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.label}</button>)}</div>
        <label className="project-memory-history"><input type="checkbox" checked={includeSuperseded} onChange={event => setIncludeSuperseded(event.target.checked)} /> Include superseded records</label>
        <div className="project-memory-entries">{records.map(record => <MemoryEntry key={record.id} record={record} index={index} selected={active?.id === record.id} choose={selectRecord} />)}</div>
        {!records.length && <div className="project-memory-empty"><strong>{index.records.length ? "No matching records" : "No public records supplied"}</strong><p>{index.records.length ? "Try another word or show every record." : "Supply public records with public sources to build this index."}</p>{index.records.length > 0 && <button type="button" onClick={() => { setKind("all"); setQuery(""); setIncludeSuperseded(true); }}>Show every record</button>}</div>}
      </section>
      {active ? <RecordDetail record={active} index={index} choose={choose} prefix={prefix} headingRef={headingRef} /> : <aside className="project-memory-detail project-memory-detail-empty"><span aria-hidden="true">◈</span><h2>A place for the reasons.</h2><p>Select a matching public record to read its sources and history.</p></aside>}
    </div>
  </section>;
}

export const styles = css;
