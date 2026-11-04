import { useState, useSyncExternalStore } from "react";
import type { Data, StepDefinition, StepRecord, WorkflowAdapter, WorkflowDefinition, WorkflowSnapshot } from "./contract";
import type { Inspector, InspectorState } from "./runtime";
import "./workflow-inspector.css";

function FeatureSwitch({ inspector, enabled }: { inspector: Inspector; enabled: boolean }) {
  return <label className="wi-switch"><input type="checkbox" checked={enabled} onChange={event => inspector.setEnabled(event.target.checked)} />Workflow inspector {enabled ? "on" : "off"}</label>;
}

function TriggerEdge({ definition, snapshot }: { definition: WorkflowDefinition; snapshot: WorkflowSnapshot }) {
  return <section aria-label="Trigger" className="wi-trigger"><h2>Why it runs</h2><strong>{definition.trigger.event}</strong><p>{definition.trigger.condition}</p><p role="status">{snapshot.trigger}</p></section>;
}

function DataFields({ title, data }: { title: string; data: Data }) {
  return <section className="wi-data"><h4>{title}</h4>{Object.keys(data).length ? <dl>{Object.entries(data).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <p>Nothing received yet</p>}</section>;
}

function StepState({ definition, record, number }: { definition: StepDefinition; record: StepRecord | undefined; number: number }) {
  return <article className="wi-step"><header><span className="wi-number">{number}</span><h3>{definition.title}</h3><span className="wi-status" role="status">{record?.status ?? "pending"}</span></header>
    <p className="wi-ref">Part: <code>{definition.partId}</code> · Step: <code>{definition.id}</code></p>
    <p>Expects {definition.inputs.join(", ")} → produces {definition.outputs.join(", ")}</p>
    {record?.error && <p role="alert">{record.error}</p>}
    <details><summary>Inspect inputs and output</summary><div className="wi-fields"><DataFields title="Inputs" data={record?.input ?? {}} /><DataFields title="Output" data={record?.output ?? {}} /></div></details>
  </article>;
}

function ReviewForm({ inspector, busy, field }: { inspector: Inspector; busy: boolean; field: string }) {
  const [value, setValue] = useState("");
  return <form onSubmit={event => { event.preventDefault(); void inspector.request({ type: "review", value }); }}>
    <label>{field.charAt(0).toUpperCase() + field.slice(1)}<input required maxLength={120} value={value} onChange={event => setValue(event.target.value)} placeholder={`Fill ${field} before approving`} /></label>
    <button disabled={busy || !value.trim()} type="submit">Approve handoff</button>
  </form>;
}

function Handoff({ definition, state, inspector }: { definition: WorkflowDefinition; state: InspectorState; inspector: Inspector }) {
  const handoff = state.snapshot.handoff;
  return <section aria-label="Review handoff" className="wi-handoff"><h3>Review & fill the gap <span className="wi-status">{handoff.status}</span></h3>
    <p>{definition.handoff.reason}</p><p className="wi-ref"><code>{definition.handoff.from}</code> → <code>{definition.handoff.partId}</code> → <code>{definition.handoff.to}</code></p>
    {handoff.status === "review" && <><DataFields title="Output offered for review" data={state.snapshot.steps.find(step => step.id === definition.handoff.from)?.output ?? {}} /><ReviewForm inspector={inspector} busy={state.busy} field={definition.handoff.field} /></>}
    {handoff.approved && <DataFields title="Approved handoff" data={handoff.approved} />}
  </section>;
}

function WorkflowControl({ inspector, state, example }: { inspector: Inspector; state: InspectorState; example: boolean }) {
  const active = ["running", "review"].includes(state.snapshot.phase);
  return <section aria-label="Workflow controls" className="wi-controls">
    <button disabled={state.busy || active} onClick={() => void inspector.request({ type: "run" })}>{example ? "Run example" : "Request run"}</button>
    <button disabled={state.busy || !active} onClick={() => void inspector.request({ type: "stop" })}>Request stop</button>
    <span role="status">{state.busy ? "Waiting for adapter response…" : `Workflow: ${state.snapshot.phase}`}</span>
    {state.requestError && <p role="alert">{state.requestError}</p>}
  </section>;
}

function WorkflowTrace({ definition, state, inspector }: { definition: WorkflowDefinition; state: InspectorState; inspector: Inspector }) {
  const [first, second] = definition.steps;
  const record = (id: string) => state.snapshot.steps.find(step => step.id === id);
  return <div className="wi-trace"><TriggerEdge definition={definition} snapshot={state.snapshot} />
    <StepState definition={first} record={record(first.id)} number={1} />
    <Handoff definition={definition} state={state} inspector={inspector} />
    <StepState definition={second} record={record(second.id)} number={2} />
  </div>;
}

export function WorkflowInspector({ definition, inspector, source }: { definition: WorkflowDefinition; inspector: Inspector; source: WorkflowAdapter["source"] }) {
  const state = useSyncExternalStore(inspector.subscribe, inspector.read, inspector.read);
  return <section className="workflow-inspector" aria-label="Workflow inspector"><header className="wi-heading"><div><p className="wi-eyebrow">Workflow inspector</p><h1>{definition.title}</h1></div><FeatureSwitch inspector={inspector} enabled={state.enabled} /></header>
    {state.enabled ? <><p className="wi-provenance">{source === "local-example" ? "Local contract example · synthetic data · no model execution" : "Runtime inspection · execution requires a connected, permitted adapter"}</p>
      <WorkflowControl inspector={inspector} state={state} example={source === "local-example"} />
      <WorkflowTrace definition={definition} state={state} inspector={inspector} /></> : <p>Off by default. Enable to inspect this workflow. Turning inspection off does not stop existing runtime work.</p>}
  </section>;
}
