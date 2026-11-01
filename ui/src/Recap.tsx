import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, World } from "./core";
import "./recap.css";

export type RecapPeriod = "today" | "session";
export interface RecapItem { thread_id: string; text: string }
export interface RecapData {
  period: RecapPeriod;
  since_ms: number;
  through_ms: number;
  generated_ms: number;
  source_key: string;
  summary: string;
  worked_on: RecapItem[];
  /** Intentions stated but not settled ("I want to…"). */
  plans: RecapItem[];
  decisions: RecapItem[];
  questions: RecapItem[];
  unfinished: RecapItem[];
  actions: Action[];
  thought_count: number;
  thread_count: number;
  limited: boolean;
}
export type RecapServerMsg = { type: "recap_state"; period: RecapPeriod; loading: boolean; message: string; recap: RecapData | null };
type View = Omit<RecapServerMsg, "type">;

export function useRecap() {
  const [view, setView] = useState<View | null>(null);
  const receive = useCallback((msg: { type: string }) => {
    if (msg.type !== "recap_state") return false;
    const state = msg as RecapServerMsg;
    setView((old) => {
      // A finished request must not reopen a sheet the person already closed.
      if (!old && !state.loading) return null;
      return { ...state, recap: state.recap ?? (old?.period === state.period ? old.recap : null) };
    });
    return true;
  }, []);
  const open = useCallback((period: RecapPeriod, recap: RecapData | null, connected: boolean) => {
    setView({ period, recap, loading: connected, message: connected ? "" : "Reconnect to make a recap. Your saved recap is still here." });
  }, []);
  const close = useCallback(() => setView(null), []);
  const disconnected = useCallback(() => setView((old) => old?.loading ? { ...old, loading: false, message: "Connection lost. Reconnect and try again." } : old), []);
  return { view, receive, open, close, disconnected };
}

export function Recap({ view, world, connected, onRequest, onClose, onFocus }: {
  view: View | null;
  world: World;
  connected: boolean;
  onRequest: (period: RecapPeriod) => void;
  onClose: () => void;
  onFocus: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = !!view;
  useEffect(() => {
    if (!open) return;
    const sheet = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheet.showModal();
    sheet.querySelector<HTMLButtonElement>(".recap-close")?.focus();
    return () => {
      sheet.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!view) return null;
  const recap = view.recap;
  const resolve = (id: string) => {
    for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[id]; hops--) id = world.merged[id];
    return id;
  };
  const title = (id: string) => world.threads.find((t) => t.id === resolve(id))?.title ?? "Open thread";
  const follow = (id: string) => { onClose(); onFocus(resolve(id)); };
  const link = (id: string, text: string, className = "recap-thread") => (
    <a className={className} href={`#thread-${resolve(id)}`} onClick={(event) => { event.preventDefault(); follow(id); }}>{text}</a>
  );
  const rows = (items: RecapItem[]) => <ul className="recap-items">{items.map((item, i) => <li key={`${item.thread_id}-${i}`}>
    {link(item.thread_id, item.text, "recap-item-link")}
    <span className="recap-source">{title(item.thread_id)} ↗</span>
  </li>)}</ul>;
  const actions = (recap?.actions ?? []).map((a) => world.actions.find((current) => current.id === a.id) ?? a).filter((a) => a.status !== "dismissed");
  const pending = actions.filter((a) => a.status !== "done");
  const added = actions.filter((a) => a.status === "done");
  const actionRows = (items: Action[]) => <ul className="recap-actions">{items.map((action) => <li key={action.id}>
    {link(action.thread_id, action.title, "recap-item-link")}
    <span className="recap-source">{title(action.thread_id)}{action.when ? ` · ${action.when}` : ""} · {action.kind === "event" && action.when ? "Calendar" : "Reminders"}</span>
  </li>)}</ul>;
  const plans = recap?.plans ?? [];
  // Only thoughts that arrived since, not ones dated ahead of this clock (the samples are dated Nov 3, 2026).
  const newer = recap && world.thoughts.some((t) => t.at_ms > recap.through_ms && t.at_ms <= Date.now());
  const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return <dialog ref={dialog} className="recap-sheet" aria-labelledby="recap-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className="recap-top">
      <span className="recap-eyebrow"><span aria-hidden="true">✦</span> Recap <span className="sr-only">by AI</span></span>
      <button className="recap-close" onClick={onClose} aria-label="Close recap">×</button>
    </div>
    <div className="recap-intro">
      <h1 id="recap-title">{view.period === "today" ? "Your day, in one place." : "Your session, in one place."}</h1>
      <div className="recap-controls">
        <div className="recap-period" role="group" aria-label="Recap period">
          <button aria-pressed={view.period === "session"} disabled={view.loading} onClick={() => onRequest("session")}>This session</button>
          <button aria-pressed={view.period === "today"} disabled={view.loading} onClick={() => onRequest("today")}>Today</button>
        </div>
        {recap && <span className="recap-meta">{recap.thought_count} {recap.thought_count === 1 ? "thought" : "thoughts"} · {recap.thread_count} {recap.thread_count === 1 ? "thread" : "threads"} · {new Date(recap.through_ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · through {time(recap.through_ms)}</span>}
      </div>
      <div className="recap-feedback" role="status" aria-live="polite">
        {view.loading ? <p className="recap-loading">Gathering your thoughts…{recap ? " Your last recap is below." : ""}</p>
          : view.message ? <p className="recap-error">{view.message}{recap ? " Showing your last saved recap." : ""}</p>
          : newer ? <p>New thoughts have arrived. Update when you're ready.</p> : null}
      </div>
      {recap && <p className="recap-summary">{recap.summary}</p>}
      {recap?.limited && <p className="recap-limit">A long stretch: showing up to 24 recent threads, 16 recent points per thread, and 64 actions. Long points are shortened.</p>}
    </div>
    {recap && <div className="recap-content" aria-busy={view.loading}>
      <section className="recap-work" aria-labelledby="recap-work-title">
        <h2 id="recap-work-title">What you worked on <span>Newest first</span></h2>
        {recap.worked_on.length ? <ol>{recap.worked_on.map((item) => <li key={item.thread_id}>
          {link(item.thread_id, `${title(item.thread_id)} ↗`)}<p>{item.text}</p>
        </li>)}</ol> : <p className="recap-empty">No threads touched in this period.</p>}
      </section>
      {(recap.decisions.length > 0 || plans.length > 0 || recap.questions.length > 0) && <div className="recap-columns">
        {recap.decisions.length > 0 && <section aria-labelledby="recap-decisions"><h2 id="recap-decisions">Decisions made</h2>{rows(recap.decisions)}</section>}
        {plans.length > 0 && <section aria-labelledby="recap-plans"><h2 id="recap-plans">Plans</h2>{rows(plans)}</section>}
        {recap.questions.length > 0 && <section aria-labelledby="recap-questions"><h2 id="recap-questions">Open questions</h2>{rows(recap.questions)}</section>}
      </div>}
      {recap.unfinished.length > 0 && <section className="recap-unfinished" aria-labelledby="recap-unfinished-title">
        <h2 id="recap-unfinished-title">Room to return</h2>
        <ul>{recap.unfinished.map((item) => {
          const thread = world.threads.find((t) => t.id === resolve(item.thread_id));
          const last = world.thoughts.filter((t) => t.placed && t.thread_id === thread?.id).at(-1);
          const resumed = thread?.status === "open" && last?.complete !== false;
          return <li key={item.thread_id}><span>{link(item.thread_id, title(item.thread_id))}<small>{resumed ? "Picked back up since this recap" : "Left off here"}</small></span>{link(item.thread_id, resumed ? "Open thread →" : "Pick up →", "recap-finish")}</li>;
        })}</ul>
      </section>}
      {actions.length > 0 && <section className="recap-action-section" aria-labelledby="recap-actions-title">
        <h2 id="recap-actions-title">Actions <span>On these threads</span></h2>
        <div className="recap-columns">
          {pending.length > 0 && <div><h3><span className="recap-pending-dot" aria-hidden="true" />Pending approval <span>{pending.length}</span></h3>{actionRows(pending)}</div>}
          {added.length > 0 && <div><h3><span className="recap-added-mark" aria-hidden="true">✓</span> Added <span>{added.length}</span></h3>{actionRows(added)}</div>}
        </div>
      </section>}
    </div>}
    <footer className="recap-footer">
      <span>{recap?.thought_count ? "Pick up any thread when you're ready." : "Your thoughts will be here."}</span>
      <button className="recap-refresh" disabled={view.loading || !connected} onClick={() => onRequest(view.period)}>{view.message ? "Try again" : "Update recap"}</button>
    </footer>
  </dialog>;
}
