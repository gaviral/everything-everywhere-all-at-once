import { useEffect, useRef, useState } from "react";
import type { BrickProps, ChoiceRequest, ChoiceRelation } from "../contract";
import { activeRelations, removalPreview } from "./rules";
import "./choice-map.css";

export default function ChoiceMap({ map, actions }: BrickProps) {
  const choices = map.choiceMaps ?? [];
  const [choiceId, setChoiceId] = useState("");
  const choice = choices.find(c => c.id === choiceId);
  const [source, setSource] = useState("");
  const [role, setRole] = useState("question");
  const [option, setOption] = useState("");
  const [pendingRemove, setPendingRemove] = useState<ChoiceRelation | null>(null);
  const [undo, setUndo] = useState<{id:string;choice:string;revision:number} | null>(null);
  const [retry, setRetry] = useState<ChoiceRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const mounted = useRef(true);
  const locked = useRef(false);
  const sourceField = useRef<HTMLSelectElement>(null);
  const focusSource = useRef(false);
  useEffect(()=>{if(!busy&&focusSource.current){focusSource.current=false;sourceField.current?.focus();}});
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = choice ? activeRelations(choice) : [];
  const options = current.filter(r => r.role === "option");
  const request = (operation:string, patch:Partial<ChoiceRequest> = {}): ChoiceRequest => ({ request_id:crypto.randomUUID(), choice_id:choice?.id ?? crypto.randomUUID(), revision:choice?.revision ?? 0, operation, ...patch });
  async function submit(req: ChoiceRequest) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setStatus("Waiting for map save…"); setRetry(req);
    try {
      const result = await actions.saveChoice?.(req);
      if (!mounted.current) return;
      if (!result) { setStatus("Choice map is unavailable."); return; }
      setStatus(result.message);
      if (result.request_id === req.request_id && result.ok) {
        setRetry(null); setChoiceId(req.choice_id);
        if (req.operation === "remove") { setUndo({id:req.request_id,choice:req.choice_id,revision:req.revision+1}); setPendingRemove(null); focusSource.current=true; }
        else { setUndo(null); if (req.operation === "add") { setSource(""); setRole("option"); focusSource.current=true; } }
      }
    } catch { if (mounted.current) setStatus("Save unconfirmed. Draft kept; retry explicitly."); }
    finally { locked.current=false; if (mounted.current) setBusy(false); }
  }
  function row(r: ChoiceRelation): React.ReactNode {
    const original = map.thoughts.find(t => t.id === r.source_id);
    const changed = original && original.text !== r.excerpt;
    return <li key={r.id} data-choice-role={r.role}>
      <strong>{r.role[0].toUpperCase()+r.role.slice(1)}</strong> · {original?.speaker ?? r.speaker}
      <blockquote>{original?.text ?? r.excerpt}</blockquote>
      {!original && <p>Source missing. Showing captured excerpt only.</p>}
      {changed && <details><summary>Source changed · captured excerpt</summary><blockquote>{r.excerpt}</blockquote></details>}
      <p>Classified by {r.actor}</p>
      <div className="choice-map-controls">
        <button disabled={!original?.thread_id} onClick={() => { if (original?.thread_id) actions.openThought(original.id); }}>Open original</button>
        {r.role === "option" && <button disabled={busy || !map.connected} onClick={() => void submit(request("choose", {relation_id:r.id}))}>Mark chosen</button>}
        <button ref={el => { if (el) removeButtons.current.set(r.id,el); else removeButtons.current.delete(r.id); }} disabled={busy} onClick={() => setPendingRemove(r)}>Remove role</button>
      </div>
      {choice?.votes.filter(v => v.option_id === r.id).map(v => <p key={v.actor}>Chosen by {v.actor} · version {v.revision}</p>)}
      {r.role === "option" && <ul>{current.filter(reason => reason.option_id === r.id).map(row)}</ul>}
    </li>;
  }
  return <section className="choice-map" aria-label="Choice map">
    <h2>Choice map</h2>
    <p>Roles are a person's classification. Each person's choice is their own; it does not mean group agreement.</p>
    <label>Choice<select value={choiceId} disabled={busy} onChange={e => {setChoiceId(e.target.value);setRole(e.target.value ? "option":"question");setPendingRemove(null);setUndo(null);setRetry(null);}}>
      <option value="">New choice</option>{choices.map(c => <option key={c.id} value={c.id}>{c.relations.find(r=>r.role==="question")?.excerpt.slice(0,80) ?? c.id}</option>)}
    </select></label>
    <form onSubmit={e => {e.preventDefault();const thought=map.thoughts.find(t=>t.id===source);if (thought) void submit(request("add",{relation_id:crypto.randomUUID(),source_id:thought.id,observed:thought.text,role,option_id:role==="supports"||role==="challenges"?option:null}));}} onKeyDown={e => { if(e.key==="Escape") { e.stopPropagation();setSource("");setRetry(null);sourceField.current?.focus(); } }}>
      <label>Existing thought<select ref={sourceField} value={source} disabled={busy} onChange={e=>{setSource(e.target.value);setRetry(null);}}><option value="">Choose a source</option>{map.thoughts.map(t=><option key={t.id} value={t.id}>{t.speaker}: {t.text.slice(0,120)}</option>)}</select></label>
      <label>Role<select value={role} disabled={busy} onChange={e=>{setRole(e.target.value);setRetry(null);}}>{(choice?["option","supports","challenges"]:["question"]).map(r=><option key={r} value={r}>{r[0].toUpperCase()+r.slice(1)}</option>)}</select></label>
      {(role==="supports"||role==="challenges") && <label>Reason for option<select value={option} disabled={busy} onChange={e=>setOption(e.target.value)}><option value="">Choose an option</option>{options.map(r=><option key={r.id} value={r.id}>{r.excerpt.slice(0,100)}</option>)}</select></label>}
      <button disabled={busy||!map.connected||!source||((role==="supports"||role==="challenges")&&!option)} type="submit">Add role</button>
      <button type="button" disabled={busy} onClick={()=>{setSource("");setRetry(null);sourceField.current?.focus();}}>Cancel</button>
    </form>
    {choice && <ul className="choice-map-list">{current.filter(r=>r.role==="question"||r.role==="option").map(row)}</ul>}
    {choice && !current.length && <p>All roles removed. Original thoughts remain on the map.</p>}
    {pendingRemove && choice && <div role="group" aria-label="Confirm removal" className="choice-map-confirm" onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();setPendingRemove(null);removeButtons.current.get(pendingRemove.id)?.focus();}}}>
      <p>Remove {removalPreview(choice,pendingRemove).length} roles? Original thoughts stay.</p>
      <ul>{removalPreview(choice,pendingRemove).map(r=><li key={r.id}>{r.role}: {r.excerpt}</li>)}</ul>
      <button autoFocus disabled={busy||!map.connected} onClick={()=>void submit(request("remove",{relation_id:pendingRemove.id}))}>Confirm remove</button>
      <button disabled={busy} onClick={()=>{setPendingRemove(null);removeButtons.current.get(pendingRemove.id)?.focus();}}>Cancel removal</button>
    </div>}
    {undo && choice?.id===undo.choice && choice.revision===undo.revision && <button disabled={busy||!map.connected} onClick={()=>void submit(request("undo",{undo_of:undo.id}))}>Undo removal</button>}
    {retry && !busy && <button onClick={()=>void submit(retry)}>Retry same request</button>}
    {!map.connected && <p>Connection lost. Draft kept; saves need a connection.</p>}
    <p role="status">{status}</p>
    <button onClick={()=>actions.closeView()}>Back to map</button>
  </section>;
}
