import { useEffect, useRef, useState } from "react";
import type { Action, ActionEstimate, BrickProps, EstimateRequest } from "../contract";
import { actionState, durationError, selectedEffort, sourceMatches } from "./rules";
import "./action-estimates.css";

export default function ActionEstimates({ map, actions }: BrickProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const estimates = map.actionEstimates ?? [];
  const total = selectedEffort(map.reminders, estimates, map.me, selected);
  const unavailable = estimates.filter(e => e.minutes !== null && !map.reminders.some(a => sourceMatches(e, a)));
  return <section className="action-estimates" aria-label="Action estimates">
    <details>
      <summary>Action estimates · Estimate effort</summary>
      <div className="action-estimates-body">
        <p>Your estimate is effort, separate from a scheduled date, event length, deadline or task completion.</p>
        <p>Saved to this map. On a shared map, everyone can see estimates and who entered them.</p>
        <p role="status">Estimated effort for {total.count} selected actions: {total.minutes} minutes</p>
        {!map.reminders.length && <p>No actions yet.</p>}
        {map.reminders.map(action => <EstimateRow key={action.id} action={action} topic={map.threads.find(t => t.id === action.thread_id)?.title ?? action.thread_id}
          estimates={estimates.filter(e => e.action_id === action.id)} me={map.me} connected={map.connected} actions={actions}
          editing={editing === action.id} edit={() => setEditing(action.id)} close={() => setEditing(null)}
          selected={selected.has(action.id)} select={value => setSelected(previous => { const next = new Set(previous); if (value) next.add(action.id); else next.delete(action.id); return next; })} />)}
        {unavailable.length > 0 && <details><summary>Unavailable sources ({unavailable.length})</summary>{unavailable.map(e => <p key={`${e.owner}:${e.action_id}`}>
          {e.source_title} · {e.source_topic} · {e.action_id} · {e.owner}: {e.minutes} minutes. Source removed or changed; estimate unavailable.
        </p>)}</details>}
      </div>
    </details>
  </section>;
}

function EstimateRow({ action, topic, estimates, me, connected, actions, editing, edit, close, selected, select }: {
  action: Action; topic: string; estimates: readonly Readonly<ActionEstimate>[]; me: string; connected: boolean; actions: BrickProps["actions"];
  editing: boolean; edit(): void; close(): void; selected: boolean; select(value: boolean): void;
}) {
  const mine = estimates.find(e => e.owner === me);
  const current = mine && sourceMatches(mine, action) ? mine : undefined;
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [observed, setObserved] = useState(0);
  const [source, setSource] = useState({ title: action.title, thread: action.thread_id });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<EstimateRequest | null>(null);
  const [undo, setUndo] = useState<Readonly<ActionEstimate> | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const focusReturn = useRef(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const begin = () => {
    setMinutes(current?.minutes?.toString() ?? ""); setReason(current?.reason ?? ""); setObserved(mine?.revision ?? 0);
    setSource({ title: action.title, thread: action.thread_id }); setRetry(null); setMessage(""); edit();
  };
  useEffect(() => {
    if (focusReturn.current && !editing && !busy) { focusReturn.current = false; editButton.current?.focus(); }
  }, [editing, busy]);
  const leave = () => { focusReturn.current = true; close(); };
  const request = (value: number | null, why: string, revision: number, undoOf?: string): EstimateRequest => ({
    request_id: crypto.randomUUID(), action_id: action.id, source_title: source.title, source_thread_id: source.thread,
    observed_revision: revision, minutes: value, reason: why, undo_of: undoOf ?? null,
  });
  const submit = async (req: EstimateRequest) => {
    if (busy) return;
    if (!actions.setActionEstimate) { setMessage("Action estimates is unavailable."); return; }
    const run = ++sequence.current;
    setBusy(true); setMessage("Waiting for map save…"); setRetry(req);
    try {
      const result = await actions.setActionEstimate(req);
      if (!mounted.current || run !== sequence.current) return;
      setMessage(result.message);
      if (result.ok && result.request_id === req.request_id && result.estimate) {
        setRetry(null); setUndo(req.minutes === null ? result.estimate : null); setObserved(result.estimate.revision);
        leave();
      }
    } catch { if (mounted.current) setMessage("Save unconfirmed. Your draft is kept; retry explicitly."); }
    finally { if (mounted.current && run === sequence.current) setBusy(false); }
  };
  return <article className="action-estimates-row" data-estimate-action={action.id}>
    <strong>{action.title}</strong>
    <p>Source topic: {topic} · {actionState(action.status)} · <code>{action.id}</code></p>
    <p>Your estimate: {current?.minutes != null ? `${current.minutes} minutes${current.reason ? ` · ${current.reason}` : ""}` : "No estimate"}</p>
    {estimates.filter(e => e.owner !== me && e.minutes !== null && sourceMatches(e, action)).map(e => <p key={e.owner}>{e.owner}: {e.minutes} minutes{e.reason ? ` · ${e.reason}` : ""} · read only</p>)}
    <div className="action-estimates-controls">
      <label><input type="checkbox" checked={selected && current?.minutes != null} disabled={current?.minutes == null} onChange={e => select(e.target.checked)} />Include in total</label>
      <button ref={editButton} type="button" onClick={begin} disabled={busy}>{current?.minutes != null ? "Edit" : "Estimate effort"}</button>
      {current?.minutes != null && !editing && <button type="button" disabled={busy} onClick={() => {
        setSource({ title: action.title, thread: action.thread_id });
        void submit({ ...request(null, "", mine?.revision ?? 0), source_title: action.title, source_thread_id: action.thread_id });
      }}>Clear</button>}
      {undo && current && mine?.revision === undo.revision && mine.minutes === null && <button type="button" disabled={busy} onClick={() => {
        if (undo.cleared) void submit(request(undo.cleared.minutes, undo.cleared.reason, undo.revision, undo.request.request_id));
      }}>Undo clear</button>}
    </div>
    {editing && <form className="action-estimates-editor" onSubmit={event => {
      event.preventDefault(); const invalid = durationError(minutes, reason);
      if (invalid) { setMessage(invalid); return; }
      void submit(request(Number(minutes), reason, observed));
    }} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); leave(); } }}>
      <p>Exact action source: {source.title} · {source.thread}</p>
      <label>Your estimate <span className="action-estimates-duration"><input ref={field} disabled={busy} aria-label="Your estimate in minutes" inputMode="numeric" value={minutes} onChange={e => { setMinutes(e.target.value); setRetry(null); }} /> minutes</span></label>
      <label>Reason (optional, 160 characters)<textarea disabled={busy} value={reason} onChange={e => { setReason(e.target.value); setRetry(null); }} rows={2} /></label>
      <div className="action-estimates-controls"><button type="submit" disabled={busy || !connected}>Save estimate</button><button type="button" disabled={busy} onClick={leave}>Cancel</button></div>
      {mine?.revision !== undefined && mine.revision !== observed && <p>Estimate changed. Cancel and Edit to inspect the current revision; this draft is kept.</p>}
    </form>}
    {retry && !busy && <button type="button" onClick={() => void submit(retry)}>Retry same request</button>}
    {message && <p role="status">{message}</p>}
  </article>;
}
