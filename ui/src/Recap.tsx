import { usePluginState } from "./bricks/contract";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Action, World } from "./core";
import { ideaCounts } from "./chunks";
import { resolveMerged } from "./merges";
import "./recap.css";
import { TIPS } from "./Tips";
import { runningModel, useSteps } from "./model-line";
import { capitalized } from "./core";
import { Markdown } from "./md";
import { actionLine, dated } from "./action-line";
import { useSite } from "./site";

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
type View = Omit<RecapServerMsg, "type"> & { fallbackSince?: number };

// The core's session boundary includes unplaced thoughts; its recap includes placed points.
export function recapFallback(world: World, now = Date.now()): number | undefined {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const thoughts = world.thoughts.filter((t) => t.at_ms <= now).sort((a, b) => a.at_ms - b.at_ms);
  if (thoughts.some((t) => t.placed && t.thread_id && t.at_ms >= midnight.getTime())) return;
  if (!thoughts.length) return;
  let start = thoughts.length - 1;
  while (start > 0 && thoughts[start].at_ms - thoughts[start - 1].at_ms < 30 * 60 * 1000) start--;
  if (thoughts.slice(start).some((t) => t.placed && t.thread_id)) return thoughts[start].at_ms;
}

export function isDefaultRecap(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const filler = ["and", "so", "ok", "okay", "wait", "um", "uh", "hmm", "now", "anyway", "anyways", "alright", "oh", "right"];
  while (words.length && filler.includes(words[0]!)) words.shift();
  if (words.at(-1) === "please") words.pop();
  return ["recap", "give me a recap"].includes(words.join(" "));
}

/** The sheet after one message from the core. */
export function nextRecapView(old: View | null, state: RecapServerMsg): View | null {
  // A finished request must not reopen a sheet the person already closed.
  if (!old && !state.loading) return null;
  // Nor replace a newer one: asked for Today, then Session while Today was being made, Today's answer arrives first
  // and would show the wrong period, with no sign that Session is still coming.
  if (old?.loading && !state.loading && state.period !== old.period) return old;
  return { ...state, fallbackSince: old?.period === state.period ? old.fallbackSince : undefined, recap: state.recap ?? (old?.period === state.period ? old.recap : null) };
}

export function useRecap() {
  const [view, setView] = useState<View | null>(null);
  const receive = useCallback((msg: { type: string }) => {
    if (msg.type !== "recap_state") return false;
    const state = msg as RecapServerMsg;
    setView((old) => nextRecapView(old, state));
    return true;
  }, []);
  const open = useCallback((period: RecapPeriod, recap: RecapData | null, connected: boolean, fallbackSince?: number) => {
    setView({ period, recap, fallbackSince, loading: connected, message: connected ? "" : "Reconnect to make a recap. Your saved recap is still here." });
  }, []);
  const close = useCallback(() => setView(null), []);
  const disconnected = useCallback(() => setView((old) => old?.loading ? { ...old, loading: false, message: "Connection lost. Reconnect and try again." } : old), []);
  return { view, receive, open, close, disconnected };
}

export function Recap({ onSetup, view, world, connected, noKey, resting = false, listening, onRequest, onMark, onClose, onFocus }: {
  onSetup?: () => void;
  view: View | null;
  world: World;
  connected: boolean;
  noKey: boolean;
  /** Past the hosted site's daily limit: the key is back tomorrow. */
  resting?: boolean;
  /** The mic is on, so a spoken command reaches the core. */
  listening: boolean;
  onRequest: (period: RecapPeriod) => void;
  /** Marks a recap as off, or takes the mark back; false when it couldn't be sent. */
  onMark: (kind: "recap", id: string, off: boolean) => boolean;
  onClose: () => void;
  onFocus: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { calendarFile } = useSite();
  // Recaps marked off in this window, by period and when each was made.
  const [off, setOff] = usePluginState<ReadonlySet<string>>("recap-off", new Set());
  // The wait named: the model the core is asking for this recap, from its own call (model-line.ts); a draft being made
  // when asked is waited for and answers it (recap.rs).
  const reading = runningModel(useSteps().state, "recap", "recap draft");
  const open = !!view;
  useEffect(() => {
    if (!open) return;
    const sheet = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    // A ring on × only when the focus before it showed one (the keyboard), as Chrome decides: Safari's showModal()
    // rings its first button even after a click or tap, so × wore a blue ring on every Recap opened that way. Focusing
    // the same element again doesn't clear it there; leaving it first does.
    const ring = !!previous?.matches(":focus-visible");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheet.showModal();
    const close = sheet.querySelector<HTMLButtonElement>(".recap-close");
    close?.blur();
    close?.focus({ focusVisible: ring });
    return () => {
      sheet.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!view) return null;
  const recap = view.recap;
  const recapId = recap ? `${recap.period}-${recap.generated_ms}` : "";
  const resolve = (id: string) => resolveMerged(world, id);
  const title = (id: string) => world.threads.find((t) => t.id === resolve(id))?.title ?? "Open topic";
  const follow = (id: string) => { onClose(); onFocus(resolve(id)); };
  const link = (id: string, text: ReactNode, className = "recap-thread") => (
    <a className={className} href={`#thread-${resolve(id)}`} onClick={(event) => { event.preventDefault(); follow(id); }}>{text}</a>
  );
  // Each row as the map shows its point: capitalized (the core copies a decided point as said: "if under $80 …", 16 of
  // 30 rows on ec4ae51), a decision after the map's ✓ (review spec-recap #3).
  const rows = (items: RecapItem[], decided = false) => <ul className="recap-items">{items.map((item, i) => <li key={`${item.thread_id}-${i}`}>
    {decided && <span className="decided" aria-hidden="true">✓</span>}{link(item.thread_id, <Markdown text={capitalized(item.text)} />, "recap-item-link")}
    <span className="recap-source">{title(item.thread_id)} ↗</span>
  </li>)}</ul>;
  const actions = (recap?.actions ?? []).map((a) => world.actions.find((current) => current.id === a.id) ?? a).filter((a) => a.status !== "dismissed");
  const pending = actions.filter((a) => a.status === "new");
  const adding = actions.filter((a) => a.status === "kept");
  const added = actions.filter((a) => a.status === "done");
  const hasFile = calendarFile && added.some((a) => a.done_ms == null);
  const actionRows = (items: Action[]) => <ul className="recap-actions">{items.map((action) => <li key={action.id}>
    {link(action.thread_id, action.title, "recap-item-link")}
    <span className="recap-source">{title(action.thread_id)}{action.when ? ` · ${action.when}` : ""} · {action.status === "new"
      ? action.kind === "event" && action.when ? "Calendar" : "Reminders"
      : actionLine(action, action.kind === "event" && dated(action.when) ? "Calendar" : "Reminders", action.status === "done" && calendarFile).status}</span>
  </li>)}</ul>;
  const plans = recap?.plans ?? [];
  // Only thoughts that arrived since, not ones dated ahead of this clock (the samples are dated Nov 3, 2026).
  // Counted as the header and the cards count (chunks.tsx): the core's `thought_count` counts a joined pair twice.
  const counted = recap ? ideaCounts(world, recap.since_ms, recap.through_ms).thoughts : 0;
  const newer = recap && world.thoughts.some((t) => t.at_ms > recap.through_ms && t.at_ms <= Date.now());
  const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return <dialog ref={dialog} className="recap-sheet" aria-labelledby="recap-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className="recap-top">
      <span className="recap-eyebrow"><span aria-hidden="true" data-tip={TIPS.recap}>✦</span> Recap <span className="sr-only">by AI</span></span>
      <button className="recap-close" onClick={onClose} aria-label="Close recap">×</button>
    </div>
    <div className="recap-intro">
      <h1 id="recap-title">{view.period === "today" ? "Your day, in one place." : "Your session, in one place."}</h1>
      <div className="recap-controls">
        <div className="recap-period" role="group" aria-label="Recap period">
          <button aria-pressed={view.period === "session"} disabled={view.loading} onClick={() => onRequest("session")}>This session</button>
          <button aria-pressed={view.period === "today"} disabled={view.loading} onClick={() => onRequest("today")}>Today</button>
        </div>
        {recap && <span className="recap-meta">{counted} {counted === 1 ? "thought" : "thoughts"} · {recap.thread_count} {recap.thread_count === 1 ? "topic" : "topics"} · {new Date(recap.through_ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {noKey ? "last saved through" : "through"} {time(recap.through_ms)}</span>}
      </div>
      {!noKey && view.fallbackSince !== undefined && <p className="recap-limit">Nothing yet today, so here's your last session, from {new Date(view.fallbackSince).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}, {time(view.fallbackSince)}.</p>}
      <div className="recap-feedback" role="status" aria-live="polite">
        {noKey ? <p>{resting ? "Recap is back tomorrow: today's free tries are used up." : "Recap needs a working AI key."}</p> : view.loading ? <p className="recap-loading">{reading ? <><span aria-hidden="true">{reading} is {recap ? "bringing this up to date" : "reading your day"}…</span><span className="sr-only">{recap ? "Bringing this up to date…" : "Gathering your thoughts…"}</span></> : recap ? "Bringing this up to date…" : "Gathering your thoughts…"}</p>
          : view.message ? <p className="recap-error">{view.message}{recap ? " Showing your last saved recap." : ""}</p>
          : newer ? <p>New thoughts have arrived. Update when you're ready.</p> : null}
      </div>
      {recap && <p className="recap-summary">{recap.summary}</p>}
      {recap?.limited && <p className="recap-limit">A long stretch: showing up to 24 recent topics, 16 recent points per topic, and 64 actions. Long points are shortened.</p>}
    </div>
    {recap && <div className="recap-content" aria-busy={view.loading}>
      {/* The answer to "what did I decide?" comes first, and says so when there is none. */}
      <div className="recap-columns">
        <section aria-labelledby="recap-decisions"><h2 id="recap-decisions">Decisions made</h2>{recap.decisions.length ? rows(recap.decisions, true) : <p className="recap-empty">None yet</p>}</section>
        {plans.length > 0 && <section aria-labelledby="recap-plans"><h2 id="recap-plans">Plans</h2>{rows(plans)}</section>}
        {recap.questions.length > 0 && <section aria-labelledby="recap-questions"><h2 id="recap-questions">Open questions</h2>{rows(recap.questions)}</section>}
      </div>
      <section className="recap-work" aria-labelledby="recap-work-title">
        <h2 id="recap-work-title">What you worked on <span>Newest first</span></h2>
        {recap.worked_on.length ? <ol>{recap.worked_on.map((item) => <li key={item.thread_id}>
          {link(item.thread_id, `${title(item.thread_id)} ↗`)}<p><Markdown text={item.text} /></p>
        </li>)}</ol> : <p className="recap-empty">No topics touched in this period.</p>}
      </section>
      {recap.unfinished.length > 0 && <section className="recap-unfinished" aria-labelledby="recap-unfinished-title">
        <h2 id="recap-unfinished-title">Room to return</h2>
        <ul>{recap.unfinished.map((item) => {
          const thread = world.threads.find((t) => t.id === resolve(item.thread_id));
          const last = world.thoughts.filter((t) => t.placed && t.thread_id === thread?.id).at(-1);
          const resumed = thread?.status === "open" && last?.complete !== false;
          return <li key={item.thread_id}><span>{link(item.thread_id, title(item.thread_id))}<small>{resumed ? "Picked back up since this recap" : "Left off here"}</small></span>{link(item.thread_id, resumed ? "Open topic →" : "Pick up →", "recap-finish")}</li>;
        })}</ul>
      </section>}
      {actions.length > 0 && <section className="recap-action-section" aria-labelledby="recap-actions-title">
        <h2 id="recap-actions-title">Actions <span>On these topics</span></h2>
        <div className="recap-columns">
          {pending.length > 0 && <div><h3><span className="recap-pending-dot" aria-hidden="true" />Pending approval <span>{pending.length}</span></h3>{actionRows(pending)}</div>}
          {adding.length > 0 && <div><h3><span className="recap-pending-dot" aria-hidden="true" />Adding <span>{adding.length}</span></h3>{actionRows(adding)}</div>}
          {added.length > 0 && <div><h3><span className="recap-added-mark" aria-hidden="true">✓</span> {hasFile ? "Completed" : "Added"} <span>{added.length}</span></h3>{actionRows(added)}</div>}
        </div>
      </section>}
    </div>}
    <footer className="recap-footer">
      {/* Saying "map" works only while the mic listens: the composer sits behind the sheet. */}
      <span className="recap-keyboard-hint">{listening ? "Say “map” to close, or press Esc" : "Press Esc to close"}</span>
      {noKey && !resting && <span className="recap-setup">Add an AI key, then return to make your Recap.</span>}
      {!noKey && recapId && !view.loading && <button className="recap-off" aria-pressed={off.has(recapId)} disabled={!connected}
        onClick={() => {
          const next = !off.has(recapId);
          if (onMark("recap", recapId, next)) setOff((marked) => { const copy = new Set(marked); if (next) copy.add(recapId); else copy.delete(recapId); return copy; });
        }}
        title={off.has(recapId) ? "Marked off. Click to take it back." : "Off the mark? Note it, so recaps improve."}>
        {off.has(recapId) ? "Marked off" : "Off?"}
      </button>}
      {noKey && onSetup ? <button type="button" className="recap-refresh" onClick={onSetup}>Set up AI</button>
        : <button className="recap-refresh" disabled={view.loading || !connected || noKey} onClick={() => onRequest(view.period)}>{view.message ? "Try again" : "Update recap"}</button>}
    </footer>
  </dialog>;
}
