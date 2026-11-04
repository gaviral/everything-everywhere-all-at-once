import { useMemo, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { DecisionCard } from "./DecisionCard";
import { RecordForm, type FormStart } from "./RecordForm";
import { exampleSources } from "./example";
import { replacementOf, sourcesOf, type Entry } from "./model";
import { useLedger } from "./useLedger";
import css from "./decision-history.css?inline";

type Filter = "current" | "review" | "history";
// Keep navigation across a source jump and return; retain only this window's current visit.
let selection: { visit: string; example: boolean; filter: Filter } | null = null;

function HistoryWorkspace({ map, actions, sources, scope, example }: Pick<BrickProps, "map" | "actions"> & {
  sources: ReturnType<typeof sourcesOf>; scope: string | null; example: boolean;
}) {
  const { ledger, error, append } = useLedger(scope, example);
  const visit = map.visitKey ?? JSON.stringify([map.mapIdentity, map.me]);
  const [filter, updateFilter] = useState<Filter>(() => selection?.visit === visit && selection.example === example ? selection.filter : "current");
  const setFilter = (filter: Filter) => { selection = { visit, example, filter }; updateFilter(filter); };
  const [form, setForm] = useState<FormStart | null>(null);
  const [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const current = ledger.entries.filter(item => item.kind === "decision" && !replacementOf(item, ledger));
  const reviews = ledger.entries.filter(item => item.kind === "review");
  const visible = filter === "current" ? current : filter === "review" ? reviews : ledger.entries.filter(item => item.kind === "decision");
  const reveal = (id: string) => {
    setFilter("history");
    requestAnimationFrame(() => {
      const target = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-record]") ?? []).find(node => node.dataset.record === id);
      target?.focus(); target?.scrollIntoView({ block: "center", behavior: "instant" });
    });
  };
  const save = (entry: Entry) => {
    const ok = append(entry);
    if (ok) { setFilter(entry.kind === "review" ? "review" : "current"); setNotice(example ? "Example updated for this preview." : "Saved in this browser for this map."); }
    return ok;
  };
  return <div ref={root}>
    <div className="decision-history-actions"><button type="button" className="decision-history-primary" onClick={() => setForm({ kind: "decision" })}>Record a decision <span aria-hidden="true">↗</span></button><button type="button" onClick={() => setForm({ kind: "review" })}>Review a question</button></div>
    {error && <p role="alert" className="decision-history-warning">{error}</p>}
    <p role="status" className="decision-history-notice">{notice}</p>
    {form && <RecordForm key={`${form.kind}:${form.from?.id ?? "new"}`} start={form} sources={sources} actor={example ? "Example participant" : map.me} blocked={!!error} save={save} cancel={() => setForm(null)} />}
    <div className="decision-history-filters" role="group" aria-label="Decision history sections">
      <button type="button" aria-pressed={filter === "current"} onClick={() => setFilter("current")}>Current decisions <strong>{current.length}</strong></button>
      <button type="button" aria-pressed={filter === "review"} onClick={() => setFilter("review")}>Review notes <strong>{reviews.length}</strong></button>
      <button type="button" aria-pressed={filter === "history"} onClick={() => setFilter("history")}>Decision history <strong>{ledger.entries.length - reviews.length}</strong></button>
    </div>
    {filter === "review" && <p className="decision-history-separation">Review keeps the question and its context. Recording a decision is a separate step.</p>}
    <div className="decision-history-cards">{visible.slice().reverse().map(entry => <DecisionCard key={entry.id} entry={entry} ledger={ledger} sources={sources} actions={actions} example={example} reveal={reveal} start={from => setForm({ kind: "decision", from })} />)}</div>
    {!visible.length && <div className="decision-history-empty"><h2>{filter === "review" ? "Room to think before choosing." : "Give the next choice its reasons."}</h2><p>{sources.length ? `${sources.length} source turns ready. Select a source and record the question, reason and condition.` : "Your map has no placed words yet. Explore the example above, or add a thought on the map."}</p></div>}
  </div>;
}

function DecisionHistoryVisit(props: BrickProps & { sources: ReturnType<typeof sourcesOf> }) {
  const visit = props.map.visitKey ?? JSON.stringify([props.map.mapIdentity, props.map.me]);
  const [example, updateExample] = useState(() => {
    if (selection?.visit !== visit) selection = { visit, example: !props.sources.length, filter: "current" };
    return selection.example;
  });
  const setExample = (example: boolean) => { selection = { visit, example, filter: "current" }; updateExample(example); };
  const scope = props.map.mapIdentity ? `decision-history:v1:${JSON.stringify([props.map.mapIdentity, props.map.me])}` : null;
  return <section className="decision-history" aria-label="Decision history" data-guide="decision-history">
    <div className="decision-history-intro"><div><p className="decision-history-eyebrow">Decision history <span aria-hidden="true">◈</span></p><h1>A choice.<br />And the reasons it stays.</h1><p>What won, when it applies, and the words behind it.<br />When plans change, the earlier choice stays in view.</p></div><div className="decision-history-seal" aria-hidden="true"><span>WHY</span><strong>↗</strong><span>STAYS</span></div></div>
    <div className="decision-history-mode" role="group" aria-label="History content"><button type="button" aria-pressed={!example} onClick={() => setExample(false)}>Your map</button><button type="button" aria-pressed={example} onClick={() => setExample(true)}>Explore example</button></div>
    <p className="decision-history-storage">{example ? "Interactive example · fictional content · changes stay in this preview." : "Saved only in this browser, for this map and participant. Separate from the shared Recap."}</p>
    <HistoryWorkspace key={`${scope}:${example}`} {...props} scope={scope} sources={example ? exampleSources : props.sources} example={example} />
  </section>;
}

export default function DecisionHistory(props: BrickProps) {
  const sources = useMemo(() => sourcesOf(props.map), [props.map.thoughts, props.map.threads]);
  return <DecisionHistoryVisit key={props.map.visitKey ?? `${props.map.mapIdentity}:${props.map.me}`} {...props} sources={sources} />;
}

export const styles = css;
