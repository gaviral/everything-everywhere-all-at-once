import { useLayoutEffect, useRef, useState } from "react";
import type { BrickActions, BrickProps } from "../contract";
import { decisionsOf } from "./rules";
import "./decisions.css";

type Filter = { topic: string | null; title: string } | null;
// Keep the selected snapshot across an explicit jump and return in this window. Nothing is saved on the map.
// Host actions identify the window; a new page starts at All. Weak keys need no teardown or storage listener.
const filters = new WeakMap<BrickActions, Filter>();

export default function Decisions({ map, actions }: BrickProps) {
  const [filter, setFilter] = useState<Filter>(() => filters.get(actions) ?? null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const rows = decisionsOf(map.thoughts, map.threads, filter ? filter.topic : undefined);
  const choose = (next: Filter) => { filters.set(actions, next); setFilter(next); };
  return <section className="decisions" data-guide="decisions" aria-labelledby="decisions-heading">
    <h1 id="decisions-heading" ref={heading} tabIndex={-1}>Decisions</h1>
    <p className="decisions-intro">Recorded on your map · newest first</p>
    <div className="decisions-filters" role="group" aria-label="Decision topics">
      <button type="button" aria-pressed={!filter} onClick={() => choose(null)}>All</button>
      <button type="button" aria-pressed={!!filter} onClick={() => choose({ topic: map.active,
        title: map.threads.find(topic => topic.id === map.active)?.title ?? "No active topic" })}>This topic</button>
    </div>
    {filter && <p className="decisions-scope">Topic selected: {filter.title}</p>}
    <p className="decisions-count" role="status">{rows.length} {rows.length === 1 ? "decision" : "decisions"}</p>
    {!rows.length ? <p className="decisions-empty">No decisions recorded yet.</p> : <ol className="decisions-list">
      {rows.map(thought => <li className="decisions-row" key={thought.id} data-decision={thought.id}>
        <h2>{thought.point}</h2>
        <p className="decisions-meta">
          <span>{map.threads.find(topic => topic.id === thought.thread_id)?.title}</span>
          <span>{thought.speaker}{map.speakers.get(thought.speaker)?.ai ? " · AI" : ""}</span>
          <time dateTime={new Date(thought.at_ms).toISOString()}>{new Date(thought.at_ms).toLocaleString()}</time>
        </p>
        <details className="decisions-words"><summary>Original words</summary><p>{thought.text}</p></details>
        <button type="button" className="decisions-open" aria-label={`Open original: ${thought.point}`}
          onClick={() => actions.openThought(thought.id)}>Open original</button>
      </li>)}
    </ol>}
  </section>;
}
