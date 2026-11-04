import { useEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { agenda, GROUPS, localDay, statusLabel, untilMidnight, validDay } from "./rules";
import "./next-steps.css";

export default function NextSteps({ map, actions }: BrickProps) {
  const [open, setOpen] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const [, refresh] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      launcher.current?.focus();
      return;
    }
    // Mounted only while this view is visible; disabling the feature unmounts everything.
    let timer: number;
    const update = () => {
      refresh(value => value + 1);
      window.clearTimeout(timer);
      timer = window.setTimeout(update, untilMidnight(new Date()));
    };
    update();
    window.addEventListener("focus", update);
    title.current?.focus({ preventScroll: true });
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", update); };
  }, [open]);

  const close = () => setOpen(false);
  const groups = agenda(map.reminders, localDay(new Date()), showDismissed);
  const count = GROUPS.reduce((sum, group) => sum + groups[group].length, 0);
  return <section className="next-steps" aria-label="Next steps agenda" data-guide="next-steps"
    onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    {!open ? <button ref={launcher} className="next-steps-button" type="button" onClick={() => setOpen(true)}>Show Next steps</button> : <>
      <div className="next-steps-top">
        <h1 ref={title} tabIndex={-1}>Next steps</h1>
        <button className="next-steps-button" type="button" onClick={close}>Close</button>
      </div>
      <p className="next-steps-help">Proposed reminders and events from this map, by local day. Handled by E2A2O does not mean the task is completed or an external app is in sync. Approval and export stay on the topic.</p>
      <label className="next-steps-filter"><input type="checkbox" checked={showDismissed} onChange={event => setShowDismissed(event.target.checked)} /> Show dismissed</label>
      {count === 0 && <p className="next-steps-empty">No next steps to show. Proposed reminders and events will appear here. Ideas are not tasks.</p>}
      {GROUPS.map(group => <section key={group} className="next-steps-group" aria-label={group} data-group={group}>
        <h2>{group} <span className="next-steps-count">{groups[group].length}</span></h2>
        {groups[group].length === 0 ? <p className="next-steps-empty">None</p> : <ul className="next-steps-list">
          {groups[group].map(action => {
            const topic = map.threads.find(topic => topic.id === action.thread_id);
            return <li key={action.id} className="next-steps-row" data-action={action.id}>
              <h3>{action.title}</h3>
              <p className="next-steps-details"><span>{action.kind === "event" ? "Event" : "Reminder"}</span><span>{statusLabel(action)}</span>
                {validDay(action.when) ? <time dateTime={action.when}>{action.when}</time> : <span>{action.when ? `Date unavailable · ${action.when}` : "No proposed date"}</span>}</p>
              <div className="next-steps-source"><span>Source topic: {topic?.title ?? "Topic unavailable"}</span>
                <button className="next-steps-button" type="button" disabled={!topic} aria-label={`Open topic for ${action.title}`} onClick={() => actions.openThread(action.thread_id)}>Open topic</button>
              </div>
            </li>;
          })}
        </ul>}
      </section>)}
    </>}
  </section>;
}
