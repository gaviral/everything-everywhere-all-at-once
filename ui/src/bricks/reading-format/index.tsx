import { useLayoutEffect, useRef, useState } from "react";
import type { Action, BrickProps, Job, MapSnapshot, Suggestion, Thought } from "../contract";
import { DecisionEmphasis } from "./emphasis";
import { Proposal, ReadingCard } from "./proposal";
import pluginStyles from "./reading-format.css?inline";

export default function ReadingFormat({ map, actions }: BrickProps) {
  const [reading, setReading] = useState(true);
  const [examples, setExamples] = useState<boolean | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const hasItems = hasReadingItems(map);
  const showExamples = examples ?? !hasItems;

  return <section className="reading-format" data-guide="reading-format" data-reading={reading ? "on" : "off"}
    aria-labelledby="reading-format-heading" onKeyDown={event => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); actions.closeView(); }
    }}>
    <div className="reading-format-intro">
      <div><p className="reading-format-eyebrow">Reading format</p>
        <h1 id="reading-format-heading" ref={heading} tabIndex={-1}>See the point.<br /><span>Then the path.</span></h1>
        <p className="reading-format-deck">The kind of item. The words that matter. A clear What, Why and How.</p>
      </div>
      <button type="button" onClick={() => actions.closeView()}>Back to map <span aria-hidden="true">↗</span></button>
    </div>
    <ReadingToolbar reading={reading} setReading={setReading} examples={showExamples} setExamples={setExamples} />
    <p className="reading-format-context" role="status">{showExamples
      ? "Synthetic examples · a neighbourhood library pilot · nothing saved or sent"
      : "Existing map items · original wording · review and approval stay on the original topic"}</p>
    {!map.connected && !showExamples && <p className="reading-format-warning">Disconnected. These are the last received items.</p>}
    <div className="reading-format-feed">
      {showExamples ? <ExampleReadings reading={reading} /> : <MapReadings map={map} actions={actions} reading={reading} />}
    </div>
  </section>;
}

function ReadingToolbar({ reading, setReading, examples, setExamples }: {
  reading: boolean; setReading(value: boolean): void; examples: boolean; setExamples(value: boolean): void;
}) {
  return <div className="reading-format-toolbar">
    <div className="reading-format-modes" role="group" aria-label="Reading content">
      <button type="button" aria-pressed={!examples} onClick={() => setExamples(false)}>This map</button>
      <button type="button" aria-pressed={examples} onClick={() => setExamples(true)}>Synthetic examples</button>
    </div>
    <button type="button" role="switch" aria-checked={reading} className="reading-format-switch" onClick={() => setReading(!reading)}>
      <span aria-hidden="true" className="reading-format-switch-track"><span /></span>Reading layout {reading ? "on" : "off"}
    </button>
  </div>;
}

function hasReadingItems(map: MapSnapshot) {
  return map.thoughts.some(thought => thought.placed) || !!map.suggestions.length || !!map.reminders.length || !!map.jobs.length;
}

function MapReadings({ map, actions, reading }: Pick<BrickProps, "map" | "actions"> & { reading: boolean }) {
  if (!hasReadingItems(map)) return <div className="reading-format-empty"><h2>No map items yet</h2>
    <p>Choose Synthetic examples to see the reading layout.</p></div>;
  return <>
    {map.suggestions.map(item => <ProposalReading key={item.id} item={item} map={map} actions={actions} reading={reading} />)}
    {map.thoughts.filter(thought => thought.placed).reverse().map(thought =>
      <ThoughtReading key={thought.id} thought={thought} map={map} actions={actions} reading={reading} />)}
    {map.jobs.map(job => <JobReading key={JSON.stringify([job.by, job.id])} job={job} />)}
    {map.reminders.map(item => <ReminderReading key={item.id} item={item} map={map} actions={actions} />)}
  </>;
}

type MapReadingProps = Pick<BrickProps, "map" | "actions">;

function TopicAction({ id, map, actions }: MapReadingProps & { id: string }) {
  return <button type="button" disabled={!map.threads.some(topic => topic.id === id)}
    onClick={() => actions.openThread(id)}>Open topic &amp; actions <span aria-hidden="true">↗</span></button>;
}

function ProposalReading({ item, map, actions, reading }: MapReadingProps & { item: Suggestion; reading: boolean }) {
  return <ReadingCard kind="proposal" title="An idea to consider"
    meta={item.status === "new" ? "Proposed · not approved" : item.status}
    actions={<TopicAction id={item.thread_id} map={map} actions={actions} />}>
    <Proposal reading={reading} content={{ what: item.text }} />
  </ReadingCard>;
}

function ThoughtReading({ thought, map, actions, reading }: MapReadingProps & { thought: Thought; reading: boolean }) {
  return <ReadingCard kind={thought.decided ? "decision" : "thought"}
    title={thought.decided ? "A decision recorded on the map" : "From the conversation"}
    meta={`${thought.speaker}${map.speakers.get(thought.speaker)?.ai ? " · AI" : ""}`}
    warnings={thought.unclear && <p>{thought.unclear}</p>}
    actions={<button type="button" onClick={() => actions.openThought(thought.id)}>Open original <span aria-hidden="true">↗</span></button>}>
    <p className="reading-format-point"><DecisionEmphasis text={thought.point || thought.text}
      phrases={reading && thought.decided && thought.point ? [thought.point] : []} /></p>
    {thought.point && thought.text !== thought.point && <p className="reading-format-original">{thought.text}</p>}
  </ReadingCard>;
}

function ReminderReading({ item, map, actions }: MapReadingProps & { item: Action }) {
  return <ReadingCard kind={item.kind} title={item.title}
    meta={item.status === "new" ? "Proposed · not approved" : item.status} warnings={item.failed && <p>{item.failed}</p>}
    actions={<TopicAction id={item.thread_id} map={map} actions={actions} />}>
    <p className="reading-format-point">{item.when || "No date supplied"}</p>
    {item.status === "done" && <p>Handled by E2A2O does not confirm external completion.</p>}
  </ReadingCard>;
}

function JobReading({ job }: { job: Job }) {
  const needsAttention = job.status === "failed" || job.status === "waiting" || job.status === "stopped" || job.outcome === "partial" || job.outcome === "failed" || job.outcome === "stopped";
  return <ReadingCard kind="result" title={job.title} meta={`${job.demo ? "Simulated · " : ""}${job.status}${job.outcome ? ` · ${job.outcome}` : ""} · ${job.by}`}
    warnings={needsAttention && <p>{job.result || "No result supplied."}</p>}>
    {!needsAttention && <p className="reading-format-original">{job.result || "No result supplied."}</p>}
  </ReadingCard>;
}

function ExampleReadings({ reading }: { reading: boolean }) {
  return <>
    <ReadingCard kind="proposal" title="A smaller launch. A clearer answer." meta="Synthetic example · not approved"
      warnings={<p>Permission is still pending. This proposal does not authorize a launch.</p>}>
      <Proposal reading={reading} content={{
        what: "Start with one neighbourhood for a two-week library pilot.",
        why: "A smaller area lets us learn whether people borrow again before we expand.",
        how: "Invite 20 households. Open on Saturday. Review repeat borrowing after two weeks.",
        emphasis: ["one neighbourhood", "two-week"],
      }} />
    </ReadingCard>
    <ReadingCard kind="decision" title="One measure of success" meta="Synthetic example · recorded decision">
      <p className="reading-format-point"><DecisionEmphasis text="Measure repeat borrowing, rather than sign-ups."
        phrases={reading ? ["repeat borrowing"] : []} /></p>
      <p>It tells us whether the library becomes useful after the first visit.</p>
    </ReadingCard>
    <ReadingCard kind="result" title="The room is available. The permit is not." meta="Synthetic example · simulated helper · waiting"
      warnings={<p>Do not send invitations until the permit is confirmed.</p>}>
      <p className="reading-format-original">The community room has space for 20 households. Permit approval is still unconfirmed.</p>
    </ReadingCard>
  </>;
}

/** Scoped styles are attached and removed by the feature host. */
export const styles = pluginStyles;
