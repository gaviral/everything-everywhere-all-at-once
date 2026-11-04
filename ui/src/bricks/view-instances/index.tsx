import { useLayoutEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { DEFINITION_ID, newReader, readVisit, retainVisit, type InstanceState } from "./state";
import { TopicReader } from "./reader";
import "./view-instances.css";

export default function ViewInstances({ map }: BrickProps) {
  const [state, setState] = useState(readVisit);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("definition");
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const focus = useRef<string | null>(null);
  const save = (next: InstanceState) => { retainVisit(next); setState(next); };
  const show = (id: string) => { setSelected(id); focus.current = id; };
  useLayoutEffect(() => {
    const target = focus.current;
    if (!open || !target) return;
    const el = target === "definition" ? panel.current?.querySelector<HTMLElement>(".view-instances-definition")
      : panel.current?.querySelector<HTMLElement>(`[data-instance="${CSS.escape(target)}"]`);
    el?.focus(); el?.scrollIntoView({ block: "nearest" }); focus.current = null;
  });
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="view-instances">
    <button className="view-instances-trigger" ref={trigger} type="button" aria-expanded={open}
      onClick={() => { if (open) close(); else { focus.current = "definition"; setOpen(true); } }}>View instances</button>
    {open && <section className="view-instances-panel" aria-label="View instances" ref={panel}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <div className="view-instances-actions"><h2>View instances</h2><button type="button" onClick={close}>Close</button></div>
      <p>Local drafts stay in this tab until page reload. Closing or switching this feature off keeps them for this visit. Nothing here sends thoughts or changes the map.</p>
      <section className="view-instances-definition" tabIndex={-1} data-selected={selected === "definition"}>
        <h3>Definition</h3><p>Topic reader · <code>{DEFINITION_ID}</code></p>
        <label>Shared heading<input value={state.heading} onChange={e => save({ ...state, heading: e.target.value })} /></label>
        <p>One reader component, shared by {state.instances.length} instances. Only this heading is shared.</p>
        <div className="view-instances-actions"><button type="button" onClick={() => {
          const reader = newReader(); save({ ...state, instances: [...state.instances, reader] }); show(reader.id);
        }}>New instance</button></div>
        <ul className="view-instances-links">{state.instances.map((reader, i) => <li key={reader.id}>
          <span>Instance {i + 1} · <code>{reader.id}</code></span>
          <button type="button" onClick={() => show(reader.id)}>Show instance {i + 1}</button>
        </li>)}</ul>
      </section>
      <section className="view-instances-list"><h3>Instances</h3>
        {!state.instances.length && <p>Use New instance to create a reader from the definition above.</p>}
        {state.instances.map(reader => <div key={reader.id} className="view-instances-placement" tabIndex={-1}
          data-instance={reader.id} data-selected={selected === reader.id}>
          <TopicReader heading={state.heading} instance={reader} map={map} definition={() => show("definition")}
            change={patch => save({ ...state, instances: state.instances.map(r => r.id === reader.id ? { ...r, ...patch } : r) })} />
        </div>)}
      </section>
    </section>}
  </div>;
}
