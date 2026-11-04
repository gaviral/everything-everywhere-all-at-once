import { useEffect, useRef, useState } from "react";
import type { BrickProps, ConnectionRequest, ConnectionPlan } from "../contract";
import "./app-connections.css";
import { canConfirm } from "./rules";

export default function AppConnections({ map, actions }: BrickProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [when, setWhen] = useState("");
  const [plans, setPlans] = useState<ConnectionPlan[]>([]);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setPlans([]); setMessage("Refresh to review current plans. Nothing is retried after reconnecting."); }, [map.connected, map.visitKey]);
  const request = async (input: ConnectionRequest) => {
    if (busy.current) return;
    if (!map.connected || !actions.appConnection) { setMessage("App connections is unavailable. No account was accessed."); return; }
    busy.current = true; setWaiting(true); setMessage("Waiting for the step receipt…");
    try {
      const result = await actions.appConnection(input);
      if (mounted.current) { setPlans(result.plans); setMessage(result.message); }
    } catch { if (mounted.current) setMessage("No receipt. Refresh and check the target app before starting another plan."); }
    finally { busy.current = false; if (mounted.current) setWaiting(false); }
  };
  const close = () => { setOpen(false); opener.current?.focus(); };
  return <section className="app-connections" aria-label="App connections">
    <button ref={opener} type="button" aria-expanded={open} onClick={() => { if (!open) void request({ operation: "list" }); setOpen(!open); }}>App connections</button>
    {open && <div className="app-connections-body" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <div className="app-connections-tools"><strong>Reminders → Calendar → tune</strong><button type="button" onClick={close}>Close</button></div>
      <p>On your local Mac: read one matching title from the E2A2O Reminders list, add an all-day event to the E2A2O calendar, then play a tune. Each step needs its own confirmation.</p>
      <p>Plans last until the core restarts. Dismissing a plan leaves completed items in their apps.</p>
      <form onSubmit={e => { e.preventDefault(); void request({ operation: "plan", block: { query: query.trim(), when } }); }}>
        <label>Reminder title contains<input value={query} maxLength={160} required placeholder="For example, rent" onChange={e => setQuery(e.target.value)} /></label>
        <label>Calendar date<input type="date" value={when} required onChange={e => setWhen(e.target.value)} /></label>
        <button type="submit" disabled={waiting || !map.connected}>Preview three steps</button>
      </form>
      <div className="app-connections-tools"><button type="button" disabled={waiting || !map.connected} onClick={() => void request({ operation: "list" })}>Refresh plans</button></div>
      <p role="status" aria-live="polite">{message}</p>
      {!map.connected && <p>Disconnected. Confirmations are unavailable.</p>}
      {plans.map(plan => <article className="app-connections-plan" key={plan.id} data-connection-plan={plan.id}>
        <strong>{plan.source} · “{plan.block.query}” · {plan.block.when}</strong>
        <ol>{plan.steps.map((step, index) => <li key={step.name} data-connection-step={index}>
          <div className="app-connections-tools"><strong>{step.name}</strong><span>{step.state === "done" ? "Receipt received" : step.state === "failed" ? "Stopped" : step.state === "running" ? "Running" : "Awaiting confirmation"}</span></div>
          <p>{step.detail}</p>
          {step.state === "proposed" && <button type="button" disabled={waiting || !map.connected || !canConfirm(plan, index)} onClick={() => void request({ operation: "confirm", plan_id: plan.id, step: index })}>Confirm {step.name}</button>}
          {step.state === "failed" && <p>Following steps are blocked. Review the target app before creating a new plan.</p>}
        </li>)}</ol>
        <button type="button" disabled={waiting || !map.connected} onClick={() => void request({ operation: "dismiss", plan_id: plan.id })}>Dismiss plan</button>
      </article>)}
    </div>}
  </section>;
}
